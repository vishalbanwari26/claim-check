import { describe, expect, it } from 'vitest'
import { attachSentences, buildReport, judgeClaims, mergeDecisions, resolveRepo, splitSentences } from '../src/mastra/logic'
import type { CheckedClaim, Claim } from '../src/mastra/schemas'

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: 'C1', sentence: 1, sentenceText: 's', text: 't', kind: 'general', repoRef: null, statedLanguage: null, ...over,
})
const checked = (over: Partial<CheckedClaim> = {}): CheckedClaim => ({
  ...claim(), agentVerdict: 'no_evidence', agentReason: 'r', citedEvidence: [], flagged: true, ...over,
})
const evidence = [{ id: 'F1', text: 'fact one' }]

describe('splitSentences', () => {
  it('splits on sentence ends and new lines, and strips bullets', () => {
    expect(splitSentences('One here. Two here.\n\n- Three').map(s => s.text)).toEqual(['One here.', 'Two here.', 'Three'])
  })
  it('does not split inside a URL', () => {
    expect(splitSentences('See github.com/octocat/linguist for it.')).toHaveLength(1)
  })
})

describe('attachSentences', () => {
  const sentences = [{ n: 1, text: 'A.' }, { n: 2, text: 'B.' }]
  const extracted = { text: 'x', kind: 'general' as const, repoRef: null, statedLanguage: null }
  it('reports sentences no claim came from', () => {
    const { uncheckedSentences } = attachSentences([{ ...extracted, sentence: 1 }], sentences)
    expect(uncheckedSentences.map(s => s.n)).toEqual([2])
  })
  it('drops a claim citing a sentence that does not exist', () => {
    const { claims, uncheckedSentences } = attachSentences([{ ...extracted, sentence: 9 }], sentences)
    expect(claims).toEqual([])
    expect(uncheckedSentences).toHaveLength(2)
  })
})

describe('resolveRepo', () => {
  const projects = [{ name: 'Spoon-Knife', repo: 'octocat/Spoon-Knife' }]
  it('reads a URL, an owner/name, and a known project name', () => {
    expect(resolveRepo('https://github.com/octocat/linguist', [])).toBe('octocat/linguist')
    expect(resolveRepo('octocat/linguist', [])).toBe('octocat/linguist')
    expect(resolveRepo('spoon-knife', projects)).toBe('octocat/Spoon-Knife')
  })
  it('returns null for an unknown project rather than guessing', () => {
    expect(resolveRepo('mystery', projects)).toBeNull()
  })
})

describe('judgeClaims fails closed', () => {
  it('flags a claim the checker gave no verdict for', () => {
    const [c] = judgeClaims([claim()], [], {}, evidence)
    expect(c.flagged).toBe(true)
    expect(c.agentVerdict).toBe('no_evidence')
  })
  it('flags "supported" when the cited id does not exist', () => {
    const [c] = judgeClaims([claim()], [{ claimId: 'C1', verdict: 'supported', citedIds: ['F99'], reason: 'trust me' }], {}, evidence)
    expect(c.flagged).toBe(true)
    expect(c.agentReason).toContain('cited nothing real')
  })
  it('flags "supported" with no citation', () => {
    const [c] = judgeClaims([claim()], [{ claimId: 'C1', verdict: 'supported', citedIds: [], reason: 'obvious' }], {}, evidence)
    expect(c.flagged).toBe(true)
  })
  it('accepts "supported" with a real citation', () => {
    const [c] = judgeClaims([claim()], [{ claimId: 'C1', verdict: 'supported', citedIds: ['F1'], reason: 'r' }], {}, evidence)
    expect(c.flagged).toBe(false)
    expect(c.citedEvidence).toEqual(evidence)
  })
})

describe('judgeClaims on repo language ignores the model', () => {
  const repoClaim = claim({ kind: 'repo-language', repoRef: 'x', statedLanguage: 'Python' })
  const judge = (check: any) => judgeClaims([repoClaim], [{ claimId: 'C1', verdict: 'supported', citedIds: ['F1'], reason: 'model opinion' }], check ? { C1: check } : {}, evidence)[0]
  it('contradicts on a different language', () => {
    expect(judge({ repo: 'a/b', status: 'ok', mainLanguage: 'Ruby' }).agentVerdict).toBe('contradicted')
  })
  it('supports on the same language, ignoring case', () => {
    expect(judge({ repo: 'a/b', status: 'ok', mainLanguage: 'python' }).flagged).toBe(false)
  })
  it.each([
    ['repo not found', { repo: 'a/b', status: 'not_found', mainLanguage: null }],
    ['rate limited', { repo: 'a/b', status: 'rate_limited', mainLanguage: null }],
    ['no main language', { repo: 'a/b', status: 'ok', mainLanguage: null }],
  ])('flags as could_not_check when %s', (_name, check) => {
    const c = judge(check)
    expect(c.agentVerdict).toBe('could_not_check')
    expect(c.flagged).toBe(true)
  })
})

describe('judgeClaims on a language claim with no repo behind it', () => {
  const noRepo = claim({ kind: 'repo-language', repoRef: 'the export script', statedLanguage: 'Python' })
  it('uses the facts, because there is nothing to ask GitHub', () => {
    const [c] = judgeClaims([noRepo], [{ claimId: 'C1', verdict: 'supported', citedIds: ['F1'], reason: 'r' }], {}, evidence)
    expect(c.agentVerdict).toBe('supported')
  })
  it('is flagged when the facts say nothing', () => {
    const [c] = judgeClaims([noRepo], [{ claimId: 'C1', verdict: 'no_evidence', citedIds: [], reason: 'r' }], {}, evidence)
    expect(c.flagged).toBe(true)
  })
  it('is flagged when the checker skipped it', () => {
    expect(judgeClaims([noRepo], [], {}, evidence)[0].flagged).toBe(true)
  })
})

describe('mergeDecisions', () => {
  const flagged = [checked({ id: 'C1' }), checked({ id: 'C2' })]
  it('reports what is still undecided', () => {
    const r = mergeDecisions(flagged, [], [{ claimId: 'C1', action: 'reject' }])
    expect(r.remaining.map(c => c.id)).toEqual(['C2'])
  })
  it('keeps earlier decisions and lets a later one replace them', () => {
    const r = mergeDecisions(flagged, [{ claimId: 'C1', action: 'reject' }], [{ claimId: 'C1', action: 'approve' }, { claimId: 'C2', action: 'reject' }])
    expect(r.remaining).toEqual([])
    expect(r.decided.find(d => d.claimId === 'C1')?.action).toBe('approve')
  })
  it('refuses a correction with no text, and unknown ids', () => {
    const r = mergeDecisions(flagged, [], [{ claimId: 'C1', action: 'correct', correctedFact: '  ' }, { claimId: 'C9', action: 'approve' }])
    expect(r.problems).toHaveLength(2)
    expect(r.remaining).toHaveLength(2)
  })
})

describe('buildReport', () => {
  const supported = checked({ id: 'C1', flagged: false, agentVerdict: 'supported' })
  const flagged = checked({ id: 'C2' })
  it('leaves a supported claim not verified unless a human approved it', () => {
    const r = buildReport([supported], [], [], false, 'ines', [])
    expect(r.claims[0].status).toBe('not_verified')
    expect(r.claims[0].decidedBy).toBeNull()
  })
  it('records who verified it', () => {
    const r = buildReport([supported], [], [], true, 'ines', [])
    expect(r.claims[0]).toMatchObject({ status: 'verified', decidedBy: 'ines' })
  })
  it('approving supported claims in bulk does not touch a flagged one', () => {
    const r = buildReport([flagged], [], [], true, 'ines', [])
    expect(r.claims[0].status).toBe('not_verified')
  })
  it('maps decisions to statuses', () => {
    const r = buildReport(
      [checked({ id: 'A' }), checked({ id: 'B' }), checked({ id: 'C' })], [],
      [{ claimId: 'A', action: 'approve' }, { claimId: 'B', action: 'correct', correctedFact: ' true thing ' }, { claimId: 'C', action: 'reject' }],
      false, 'ines', [],
    )
    expect(r.claims.map(c => c.status)).toEqual(['verified', 'corrected', 'rejected'])
    expect(r.claims[1].correctedFact).toBe('true thing')
    expect(r.counts).toEqual({ verified: 1, corrected: 1, rejected: 1, not_verified: 0 })
  })
})
