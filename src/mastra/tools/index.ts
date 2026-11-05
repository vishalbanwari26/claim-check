import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { readConfirmed } from '../ledger'
import { evidenceItem, repoCheck } from '../schemas'
import { projectRoot } from '../storage'

const candidateFile = z.object({
  name: z.string(),
  facts: z.array(evidenceItem),
  projects: z.array(z.object({ name: z.string(), repo: z.string() })),
})

const slug = z.string().regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits and hyphens only')

export const readConfirmedFacts = createTool({
  id: 'read-confirmed-facts',
  description:
    "Read what is confirmed about a candidate: the facts file plus everything a human confirmed in earlier reviews. Agent inferences are never included.",
  inputSchema: z.object({ candidateId: slug }),
  outputSchema: z.object({
    facts: z.array(evidenceItem.extend({ source: z.string() })),
    projects: z.array(z.object({ name: z.string(), repo: z.string() })),
  }),
  execute: async ({ candidateId }) => {
    const raw = await readFile(join(projectRoot(), 'data/candidates', `${candidateId}.json`), 'utf8')
    const file = candidateFile.parse(JSON.parse(raw))
    const confirmed = await readConfirmed(candidateId)
    return {
      facts: [
        ...file.facts.map(f => ({ ...f, source: 'candidate-file' })),
        ...confirmed.map(f => ({ id: f.id, text: f.text, source: f.source })),
      ],
      projects: file.projects,
    }
  },
})

export const readJobAd = createTool({
  id: 'read-job-ad',
  description: 'Read the text of a job ad by id.',
  inputSchema: z.object({ jobId: slug }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ jobId }) => ({
    text: await readFile(join(projectRoot(), 'data/jobs', `${jobId}.md`), 'utf8'),
  }),
})

export const checkRepoLanguage = createTool({
  id: 'check-repo-language',
  description: "Ask the public GitHub API for a repository's main language.",
  inputSchema: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Expected owner/name'),
  }),
  outputSchema: repoCheck,
  // Failures come back as data. A claim we could not check must end up flagged, not crash
  // the run and not pass by accident.
  execute: async ({ repo }) => {
    const headers: Record<string, string> = { 'User-Agent': 'claim-check', Accept: 'application/vnd.github+json' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers, signal: AbortSignal.timeout(10_000) })
      if (res.status === 404) return { repo, status: 'not_found' as const, mainLanguage: null }
      if (res.status === 403 || res.status === 429)
        return { repo, status: 'rate_limited' as const, mainLanguage: null, detail: `HTTP ${res.status}` }
      if (!res.ok) return { repo, status: 'error' as const, mainLanguage: null, detail: `HTTP ${res.status}` }
      const body = (await res.json()) as { language?: string | null }
      return { repo, status: 'ok' as const, mainLanguage: body.language ?? null }
    } catch (e) {
      return { repo, status: 'error' as const, mainLanguage: null, detail: String(e) }
    }
  },
})
