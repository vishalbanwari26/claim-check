import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { addConfirmed, addInferred } from '../ledger'
import { attachSentences, buildReport, judgeClaims, labelSentences, mergeDecisions, resolveRepo, splitSentences } from '../logic'
import {
  checkStepOutput, checkerOutput, extractStepOutput, extractorOutput, flagStepOutput, report,
  readDecisions, reviewForm, reviewSuspend, workflowInput,
} from '../schemas'
import type { Decision, RepoCheck } from '../schemas'
import { checkRepoLanguage, readConfirmedFacts, readJobAd } from '../tools'
import { reviewUrl, suspendHeadline, unwrapSuspend } from '../view'

// Tools hand back an error object rather than throwing when their input is invalid. A step
// must not carry on with that as if it were data.
const unwrap = <T>(result: T): Exclude<T, { error: true } | void> => {
  if (!result) throw new Error('Tool returned nothing')
  if (typeof result === 'object' && 'error' in result && result.error)
    throw new Error((result as unknown as { message: string }).message)
  return result as Exclude<T, { error: true } | void>
}

const callOptions = { modelSettings: { temperature: 0 } }

// Groq sometimes rejects the model's JSON (seen in evals: an object where the schema wants an
// array). The AI SDK treats that as not retryable, but a second attempt usually parses. If
// all attempts fail the run fails, and a failed run verifies nothing.
const LLM_RETRIES = 2

const extractClaims = createStep({
  id: 'extract-claims',
  description: 'Split the draft into sentences and pull out every factual claim.',
  retries: LLM_RETRIES,
  inputSchema: workflowInput,
  outputSchema: extractStepOutput,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const sentences = splitSentences(inputData.draft)
    const { object } = await mastra.getAgent('claimExtractor').generate(labelSentences(sentences), {
      ...callOptions,
      structuredOutput: { schema: extractorOutput },
      tracingContext,
    })
    return { sentences, ...attachSentences(object.claims, sentences) }
  },
})

// The workflow calls the tools itself rather than leaving it to the model. Reading the
// evidence is not optional, so it should not depend on a model choosing to do it.
const checkEvidence = createStep({
  id: 'check-evidence',
  description: 'Fetch the facts, the job ad and GitHub data, then judge each claim.',
  retries: LLM_RETRIES,
  inputSchema: extractStepOutput,
  outputSchema: checkStepOutput,
  execute: async ({ inputData, mastra, getInitData, tracingContext }) => {
    const init = getInitData<z.infer<typeof workflowInput>>()
    const { facts, projects } = unwrap(await readConfirmedFacts.execute!({ candidateId: init.candidateId }, {}))
    const { text: jobAd } = unwrap(await readJobAd.execute!({ jobId: init.jobId }, {}))
    const evidence = [...facts.map(f => ({ id: f.id, text: f.text })), { id: 'JOB', text: jobAd }]

    const repoChecks: Record<string, RepoCheck> = {}
    for (const claim of inputData.claims.filter(c => c.kind === 'repo-language')) {
      const repo = resolveRepo(claim.repoRef, projects)
      if (repo) repoChecks[claim.id] = unwrap(await checkRepoLanguage.execute!({ repo }, {}))
    }

    const general = inputData.claims.filter(c => !repoChecks[c.id])
    const llmVerdicts = general.length === 0 ? [] : (await mastra.getAgent('evidenceChecker').generate(
      `EVIDENCE\n${evidence.map(e => `[${e.id}] ${e.text}`).join('\n')}\n\nCLAIMS\n${general.map(c => `${c.id}: ${c.text}`).join('\n')}`,
      { ...callOptions, structuredOutput: { schema: checkerOutput }, tracingContext },
    )).object.verdicts

    return { ...inputData, evidence, llmVerdicts, repoChecks }
  },
})

const flagClaims = createStep({
  id: 'flag-claims',
  description: 'Apply the rules in code and record what the agent concluded, as inference only.',
  inputSchema: checkStepOutput,
  outputSchema: flagStepOutput,
  execute: async ({ inputData, runId, getInitData }) => {
    const claims = judgeClaims(inputData.claims, inputData.llmVerdicts, inputData.repoChecks, inputData.evidence)
    const { candidateId } = getInitData<z.infer<typeof workflowInput>>()
    await addInferred(candidateId, claims.map(c => ({
      runId, claimId: c.id, claimText: c.text, verdict: c.agentVerdict, reason: c.agentReason,
    })))
    return { claims, uncheckedSentences: inputData.uncheckedSentences }
  },
})

const humanReview = createStep({
  id: 'human-review',
  description: 'Stop until a human has decided every flagged claim. The only step that writes confirmed facts.',
  inputSchema: flagStepOutput,
  outputSchema: report,
  suspendSchema: reviewSuspend,
  resumeSchema: reviewForm,
  execute: async ({ inputData, resumeData, suspendData, suspend, runId, getInitData }) => {
    const flagged = inputData.claims.filter(c => c.flagged)
    // Studio prints this whole payload, so it holds only what has something to say. The title says what to do and
    // the body holds the review page's address (see suspendHeadline). The CLI and the review page rebuild the all-claims view from this
    // step's saved input instead.
    const pause = (decided: Decision[], problems: string[], reviewer?: string) =>
      suspend({
        [suspendHeadline(flagged, decided)]: {
          reviewUrl: reviewUrl(runId),
          ...(decided.length > 0 ? { decided } : {}),
          ...(problems.length > 0 ? { problems } : {}),
          ...(reviewer ? { reviewer } : {}),
        },
      })

    if (!resumeData) return pause([], [])

    // Each fact records who decided it, so one review must keep one reviewer.
    const reviewer = resumeData.reviewer.trim()
    const previous = suspendData ? unwrapSuspend(suspendData) : undefined
    const prior = previous?.decided ?? []
    const started = previous?.reviewer
    const sent = readDecisions(resumeData.decisions)
    if (!sent.success) return pause(prior, ['The decisions list could not be read.'], started)
    if (started && started.toLowerCase() !== reviewer.toLowerCase())
      return pause(prior, [`This review was started by ${started}. Use the same name, so each fact is credited to the person who decided it.`], started)

    const { decided, problems, remaining } = mergeDecisions(flagged, prior, sent.data)
    if (problems.length > 0 || remaining.length > 0) {
      const waiting = remaining.map(c => `${c.id} still needs a decision.`)
      return pause(decided, [...problems, ...waiting], started ?? reviewer)
    }

    // Nothing is written until every flagged claim has a decision.
    const { candidateId } = getInitData<z.infer<typeof workflowInput>>()
    const factsAdded: string[] = []
    for (const d of decided) {
      if (d.action === 'reject') continue
      const claim = flagged.find(c => c.id === d.claimId)!
      const fact = await addConfirmed(candidateId, {
        text: d.action === 'correct' ? d.correctedFact!.trim() : claim.text,
        source: d.action === 'correct' ? 'human-correction' : 'human-approval',
        confirmedBy: reviewer,
        runId,
        originClaim: claim.text,
      })
      factsAdded.push(fact.id)
    }
    return buildReport(inputData.claims, inputData.uncheckedSentences, decided, resumeData.approveSupported === true, reviewer, factsAdded)
  },
})

export const claimCheck = createWorkflow({
  id: 'claim-check',
  description: 'Extract claims from a job application, check them against confirmed facts, and wait for a human.',
  inputSchema: workflowInput,
  outputSchema: report,
})
  .then(extractClaims)
  .then(checkEvidence)
  .then(flagClaims)
  .then(humanReview)
  .commit()
