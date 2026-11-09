import { describe, expect, it } from 'vitest'
import { parseDecisions } from '../src/mastra/decisions'
import { reviewSuspendBody } from '../src/mastra/schemas'

describe('parseDecisions', () => {
  it('accepts a well-formed submission', () => {
    const body = { reviewer: 'ines', decisions: [{ claimId: 'C1', action: 'approve' }], approveSupported: false }
    expect(parseDecisions(body)).toEqual({ ok: true, data: body })
  })

  it('rejects an empty reviewer name and says which field', () => {
    const r = parseDecisions({ reviewer: '', decisions: [], approveSupported: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('reviewer')
  })

  it('rejects an unknown action', () => {
    expect(parseDecisions({ reviewer: 'ines', decisions: [{ claimId: 'C1', action: 'maybe' }], approveSupported: false }).ok).toBe(false)
  })

  it('accepts a correct decision without text, because mergeDecisions reports that later', () => {
    expect(parseDecisions({ reviewer: 'ines', decisions: [{ claimId: 'C1', action: 'correct' }], approveSupported: false }).ok).toBe(true)
  })
})

describe('reviewSuspendBody', () => {
  it('still accepts a payload saved before reviewUrl existed', () => {
    const old = { flagged: [], supportedAwaitingApproval: [], uncheckedSentences: [], decided: [], problems: [] }
    expect(reviewSuspendBody.parse(old).reviewUrl).toBeUndefined()
  })
})
