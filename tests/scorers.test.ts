import { describe, expect, it } from 'vitest'
import { falseClaimsCaught, scoreCase, trueClaimsNotFlagged } from '../src/mastra/scorers'

const c = (sentenceText: string, flagged: boolean) => ({
  id: 'C', sentence: 1, sentenceText, text: sentenceText, kind: 'general' as const, repoRef: null, statedLanguage: null,
  agentVerdict: flagged ? 'no_evidence' as const : 'supported' as const, agentReason: '', citedEvidence: [], flagged,
})
const truth = {
  planted: [{ includes: 'on site', type: 'location' }, { includes: 'in Python', type: 'language' }, { includes: 'nobody asked', type: 'origin' }],
  clean: [{ includes: 'engineer', type: 'control' }, { includes: 'certificate', type: 'control' }],
}
const output = {
  claims: [c('I worked on site.', true), c('I wrote it in Python.', false), c('I was an engineer.', false), c('A certificate.', true)],
  uncheckedSentences: [],
}

describe('scoreCase', () => {
  it('separates caught, marked supported and never extracted', () => {
    expect(scoreCase(output, truth).planted.map(p => p.outcome)).toEqual(['caught', 'marked_supported', 'not_extracted'])
  })
  it('finds false flags', () => {
    expect(scoreCase(output, truth).clean.map(p => p.outcome)).toEqual(['kept', 'false_flag'])
  })
})

describe('Mastra scorers', () => {
  it('score a run through the scorer pipeline', async () => {
    const caught = await falseClaimsCaught.run({ input: {}, output, groundTruth: truth })
    expect(caught.score).toBeCloseTo(1 / 3)
    expect(caught.reason).toContain('not_extracted')
    const kept = await trueClaimsNotFlagged.run({ input: {}, output, groundTruth: truth })
    expect(kept.score).toBe(0.5)
  })
  it('gives 1 when a case has nothing to catch', async () => {
    const r = await falseClaimsCaught.run({ input: {}, output, groundTruth: { planted: [], clean: [] } })
    expect(r.score).toBe(1)
  })
  // Studio can run a scorer on a trace, where there is no answer key. A score there would be
  // made up, so it has to fail and say why.
  it('refuses to score without ground truth, and says why', async () => {
    await expect(falseClaimsCaught.run({ input: {}, output })).rejects.toThrow(/needs ground truth/)
  })
  it('refuses to score output that is not the flag step', async () => {
    await expect(falseClaimsCaught.run({ input: {}, output: { text: 'a trace span' } as never, groundTruth: truth })).rejects.toThrow(/flag-claims/)
  })
})
