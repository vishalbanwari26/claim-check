// Pure helpers that shape saved runs for display. No Mastra, no network.
import { reviewSuspendBody } from './schemas'
import type { CheckedClaim, Decision, ReviewView } from './schemas'

type Sentence = { n: number; text: string }

export const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat
}

export type RunSummary = { runId: string; createdAt: string; preview: string; flaggedCount: number | null }

type SavedRun = { runId: string; createdAt: Date | string | number; steps?: Record<string, unknown> }
type Step = {
  payload?: { draft?: unknown; claims?: { flagged?: boolean }[] }
  suspendPayload?: { flagged?: unknown }
} | undefined

export const summarizeRun = (run: SavedRun, max = 120): RunSummary => {
  const step = (id: string) => run.steps?.[id] as Step
  const draft = step('extract-claims')?.payload?.draft
  // Runs saved before the slim payload kept the flagged list in the suspend payload. Newer
  // runs keep every claim in the step's input.
  const review = step('human-review')
  const oldList = review?.suspendPayload?.flagged
  const claims = review?.payload?.claims
  const flaggedCount = Array.isArray(oldList) ? oldList.length : Array.isArray(claims) ? claims.filter(c => c.flagged).length : null
  return {
    runId: run.runId,
    createdAt: new Date(run.createdAt).toISOString(),
    preview: typeof draft === 'string' ? oneLine(draft, max) : '(draft not saved)',
    flaggedCount,
  }
}

export const reviewUrl = (runId: string, base = process.env.REVIEW_BASE_URL ?? 'http://localhost:4111'): string =>
  `${base}/review?run=${encodeURIComponent(runId)}`

// The one key of the pause payload, which Studio shows as a one-line box title. Kept short so it is not
// cut off. The review page's address is in the body (reviewUrl), because Studio's form cannot show claims.
export const suspendHeadline = (flagged: CheckedClaim[], decided: Pick<Decision, 'claimId'>[]): string => {
  if (flagged.length === 0) return 'No flagged claims. Enter your name and resume to finish.'
  const left = flagged.filter(c => !decided.some(d => d.claimId === c.id)).length
  if (left === 0) return 'Every claim is decided. Resume to finish.'
  const of = left === flagged.length ? `${left}` : `${left} of ${flagged.length}`
  return `Decide ${of} claim${flagged.length === 1 ? '' : 's'} on the review page`
}

// Rebuilds the all-claims view that the CLI and the review page use, from the step's saved input
// (every claim) and the slim payload (decisions so far, problems).
export const buildReviewView = (
  input: { claims: CheckedClaim[]; uncheckedSentences: Sentence[] },
  slim: { decided: Decision[]; problems: string[]; reviewUrl?: string },
): ReviewView => ({
  flagged: input.claims.filter(c => c.flagged),
  supportedAwaitingApproval: input.claims.filter(c => !c.flagged),
  uncheckedSentences: input.uncheckedSentences,
  decided: slim.decided,
  problems: slim.problems,
  reviewUrl: slim.reviewUrl,
})

// Reads a saved suspend payload in any of its shapes: wrapped under one headline key (current),
// flat (earlier today), or flat with the full flagged list (the first version).
export const unwrapSuspend = (raw: unknown) => {
  const obj = (raw ?? {}) as Record<string, unknown>
  const keys = Object.keys(obj)
  const inner = keys.length === 1 && !('decided' in obj) ? obj[keys[0]] : obj
  return reviewSuspendBody.parse(inner)
}
