import { createScorer } from '@mastra/core/evals'
import type { z } from 'zod'
import type { flagStepOutput } from './schemas'

type FlagOutput = z.infer<typeof flagStepOutput>

// Ground truth is labelled by sentence, because that is what we can write down before
// seeing any model output. `includes` is a piece of text that identifies the sentence.
export type GroundTruth = {
  planted: { includes: string; type: string }[]
  clean: { includes: string; type: string }[]
}

export type PlantedResult = { includes: string; type: string; outcome: 'caught' | 'not_extracted' | 'marked_supported' }
export type CleanResult = { includes: string; type: string; outcome: 'kept' | 'false_flag'; claim?: string }

export const scoreCase = (output: FlagOutput, truth: GroundTruth) => {
  // Studio can run a scorer on a trace, with no answer key and a different output shape. Any
  // number from that would be made up, so stop and say what is missing.
  if (!truth?.planted || !truth?.clean) throw new Error('This scorer needs ground truth, which only the eval cases have. Use npm run evals -- --studio.')
  if (!Array.isArray(output?.claims)) throw new Error('This scorer reads the output of the flag-claims step, and got something else.')
  const from = (needle: string) => output.claims.filter(c => c.sentenceText.includes(needle))
  const planted: PlantedResult[] = truth.planted.map(({ includes, type }) => {
    const claims = from(includes)
    const outcome = claims.length === 0 ? 'not_extracted' as const : claims.some(c => c.flagged) ? 'caught' as const : 'marked_supported' as const
    return { includes, type, outcome }
  })
  const clean: CleanResult[] = truth.clean.map(({ includes, type }) => {
    const bad = from(includes).find(c => c.flagged)
    return bad ? { includes, type, outcome: 'false_flag', claim: bad.text } : { includes, type, outcome: 'kept' }
  })
  return { planted, clean }
}

const scorerFor = <Id extends string>(id: Id, description: string, pick: (s: ReturnType<typeof scoreCase>) => { good: number; total: number; bad: string[] }) =>
  createScorer<unknown, FlagOutput, Id>({ id, description })
    .preprocess(({ run }) => pick(scoreCase(run.output, run.groundTruth as GroundTruth)))
    .generateScore(({ results }) => {
      const { good, total } = results.preprocessStepResult
      return total === 0 ? 1 : good / total
    })
    .generateReason(({ results }) => {
      const { good, total, bad } = results.preprocessStepResult
      return `${good} of ${total}.${bad.length ? ` Wrong: ${bad.join('; ')}` : ''}`
    })

export const falseClaimsCaught = scorerFor(
  'false-claims-caught',
  'Share of planted false claims that end up flagged for a human',
  ({ planted }) => ({
    good: planted.filter(p => p.outcome === 'caught').length,
    total: planted.length,
    bad: planted.filter(p => p.outcome !== 'caught').map(p => `${p.outcome}: ${p.includes}`),
  }),
)

export const trueClaimsNotFlagged = scorerFor(
  'true-claims-not-flagged',
  'Share of true sentences that do not waste the reviewer\'s time with a flag',
  ({ clean }) => ({
    good: clean.filter(c => c.outcome === 'kept').length,
    total: clean.length,
    bad: clean.filter(c => c.outcome !== 'kept').map(c => `${c.includes} (${c.claim})`),
  }),
)
