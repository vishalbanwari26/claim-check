import { describe, expect, it } from 'vitest'
import { buildReviewView, oneLine, reviewUrl, summarizeRun, suspendHeadline, unwrapSuspend } from '../src/mastra/view'

describe('oneLine', () => {
  it('collapses whitespace and line breaks into single spaces', () => {
    expect(oneLine('  Dear team,\n\nI know   Python.  ', 100)).toBe('Dear team, I know Python.')
  })

  it('leaves short text alone', () => {
    expect(oneLine('Short.', 100)).toBe('Short.')
  })

  it('cuts long text and adds three dots', () => {
    expect(oneLine('a'.repeat(130), 120)).toBe('a'.repeat(120) + '...')
  })
})

const saved = {
  runId: 'r1',
  createdAt: '2026-11-06T00:04:09.000Z',
  steps: {
    'extract-claims': { payload: { draft: 'Dear team,\n\nI know Python.' } },
    'human-review': { suspendPayload: { flagged: [{}, {}] } },
  },
}

describe('summarizeRun', () => {
  it('builds a row from a saved run', () => {
    expect(summarizeRun(saved)).toEqual({ runId: 'r1', createdAt: '2026-11-06T00:04:09.000Z', preview: 'Dear team, I know Python.', flaggedCount: 2 })
  })

  it('shows placeholders when the steps are missing', () => {
    expect(summarizeRun({ runId: 'r2', createdAt: 0 })).toEqual({ runId: 'r2', createdAt: '1970-01-01T00:00:00.000Z', preview: '(draft not saved)', flaggedCount: null })
  })

  it('keeps 0 for a run that really has no flagged claims', () => {
    const run = { runId: 'r3', createdAt: 0, steps: { 'human-review': { suspendPayload: { flagged: [] } } } }
    expect(summarizeRun(run).flaggedCount).toBe(0)
  })
})

describe('reviewUrl', () => {
  it('builds the review link for a run', () => {
    expect(reviewUrl('abc', 'http://localhost:4111')).toBe('http://localhost:4111/review?run=abc')
  })

  it('encodes the run id', () => {
    expect(reviewUrl('a b/c', 'http://x')).toBe('http://x/review?run=a%20b%2Fc')
  })
})

const claimOf = (id: string, flagged = true) => ({
  id, sentence: 1, sentenceText: 'S.', text: `claim ${id}`, kind: 'general' as const, repoRef: null, statedLanguage: null,
  agentVerdict: 'no_evidence' as const, agentReason: `reason ${id}`, citedEvidence: [{ id: 'F1', text: 'First line\nsecond line' }], flagged,
})

describe('the title Studio shows', () => {
  const flagged = [claimOf('C2'), claimOf('C3'), claimOf('C4')]

  it('says how many claims are left, and where to go. It says how many claims are left', () => {
    expect(suspendHeadline(flagged, [])).toBe('Decide 3 claims on the review page')
    expect(suspendHeadline([flagged[0]], [])).toBe('Decide 1 claim on the review page')
    expect(suspendHeadline(flagged, [{ claimId: 'C2' }])).toBe('Decide 2 of 3 claims on the review page')
  })

  it('says when there is nothing left, or nothing to start with', () => {
    expect(suspendHeadline(flagged, flagged.map(c => ({ claimId: c.id })))).toContain('Resume to finish')
    expect(suspendHeadline([], [])).toContain('No flagged claims')
  })

  it('rebuilds the all-claims view for the CLI and the page', () => {
    const claims = [...flagged, claimOf('C1', false)]
    const view = buildReviewView({ claims, uncheckedSentences: [{ n: 9, text: 'Unread.' }] }, { decided: [], problems: ['p'], reviewUrl: 'u' })
    expect(view.flagged.map(c => c.id)).toEqual(['C2', 'C3', 'C4'])
    expect(view.supportedAwaitingApproval.map(c => c.id)).toEqual(['C1'])
    expect(view).toMatchObject({ problems: ['p'], reviewUrl: 'u', uncheckedSentences: [{ n: 9, text: 'Unread.' }] })
  })

  it('counts flagged claims from the step input for runs saved with the slim payload', () => {
    const run = { runId: 'r4', createdAt: 0, steps: { 'human-review': { payload: { claims: [{ flagged: true }, { flagged: false }, { flagged: true }] }, suspendPayload: {} } } }
    expect(summarizeRun(run).flaggedCount).toBe(2)
  })
})

describe('unwrapSuspend', () => {
  const body = { decided: [], problems: [], uncheckedSentences: [], reviewer: 'ines' }

  it('reads a payload wrapped under its headline', () => {
    expect(unwrapSuspend({ '2 claims to decide. Open this box to read them.': body }).reviewer).toBe('ines')
  })

  it('fills in the fields a lean payload leaves out', () => {
    expect(unwrapSuspend({ 'Headline': { claims: [] } })).toMatchObject({ decided: [], problems: [], uncheckedSentences: [] })
  })

  it('still reads the flat shapes saved earlier', () => {
    expect(unwrapSuspend(body).reviewer).toBe('ines')
    expect(unwrapSuspend({ ...body, flagged: [], supportedAwaitingApproval: [] }).decided).toEqual([])
  })

  it('throws on a payload that is not a review pause', () => {
    expect(() => unwrapSuspend({ something: 'else' })).toThrow()
  })
})
