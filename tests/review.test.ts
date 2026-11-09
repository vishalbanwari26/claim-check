import { describe, expect, it } from 'vitest'
import { pendingFor, startRun, submitDecisions, viewFromSteps } from '../src/mastra/review'
import type { Workflow } from '../src/mastra/review'

const fake = (state: unknown) => ({ getWorkflowRunById: async () => state }) as unknown as Workflow
const payload = { flagged: [], supportedAwaitingApproval: [], uncheckedSentences: [], decided: [], problems: [] }

describe('pendingFor', () => {
  it('throws when the run does not exist', async () => {
    await expect(pendingFor(fake(null), 'r1')).rejects.toThrow('No run r1')
  })

  it('throws when the run is not suspended', async () => {
    await expect(pendingFor(fake({ status: 'success' }), 'r1')).rejects.toThrow('Run r1 is success, not suspended')
  })

  it('returns the suspend payload of the human-review step', async () => {
    const state = { status: 'suspended', steps: { 'human-review': { suspendPayload: payload } } }
    await expect(pendingFor(fake(state), 'r1')).resolves.toEqual(payload)
  })
})

const fakeRun = (result: unknown) => ({ createRun: async () => ({ runId: 'r9', start: async () => result }) }) as unknown as Workflow
const input = { draft: 'I know Python.', candidateId: 'ines-varga', jobId: 'quillbeam-ai-engineer' }

describe('startRun', () => {
  it('returns the run id and the pending review', async () => {
    const result = { status: 'suspended', steps: { 'human-review': { suspendPayload: payload } } }
    await expect(startRun(fakeRun(result), input)).resolves.toEqual({ runId: 'r9', pending: payload })
  })

  it('refuses a run that did not stop for review', async () => {
    await expect(startRun(fakeRun({ status: 'failed' }), input)).rejects.toThrow('Expected to stop for review, got failed')
  })
})

const fakeResume = (result: unknown) => ({ createRun: async () => ({ resume: async () => result }) }) as unknown as Workflow
const resumeData = { reviewer: 'ines', decisions: [], approveSupported: false }

describe('submitDecisions', () => {
  it('returns the report when every claim was decided', async () => {
    const report = { claims: [], uncheckedSentences: [], counts: {}, factsAdded: [] }
    await expect(submitDecisions(fakeResume({ status: 'success', result: report }), 'r1', resumeData)).resolves.toEqual({ done: true, report })
  })

  it('returns what is still pending after a partial review', async () => {
    const result = { status: 'suspended', steps: { 'human-review': { suspendPayload: payload } } }
    await expect(submitDecisions(fakeResume(result), 'r1', resumeData)).resolves.toEqual({ done: false, pending: payload })
  })

  it('throws on any other end state', async () => {
    await expect(submitDecisions(fakeResume({ status: 'failed' }), 'r1', resumeData)).rejects.toThrow('Resume ended as failed')
  })
})

describe('viewFromSteps', () => {
  const claim = (id: string, flagged: boolean) => ({
    id, sentence: 1, sentenceText: 'S.', text: `claim ${id}`, kind: 'general', repoRef: null, statedLanguage: null,
    agentVerdict: flagged ? 'no_evidence' : 'supported', agentReason: 'r', citedEvidence: [], flagged,
  })
  const input = { claims: [claim('C1', false), claim('C2', true)], uncheckedSentences: [] }
  const slimPayload = { decided: [{ claimId: 'C2', action: 'reject' }], problems: [], uncheckedSentences: [], reviewUrl: 'u' }

  it('rebuilds every claim from the review step input (a saved run)', () => {
    const view = viewFromSteps({ 'human-review': { payload: input, suspendPayload: slimPayload } })
    expect(view.flagged.map(c => c.id)).toEqual(['C2'])
    expect(view.supportedAwaitingApproval.map(c => c.id)).toEqual(['C1'])
    expect(view).toMatchObject({ decided: [{ claimId: 'C2', action: 'reject' }], reviewUrl: 'u' })
  })

  it('falls back to the flag-claims output (a fresh start or resume result)', () => {
    const view = viewFromSteps({ 'flag-claims': { output: input }, 'human-review': { suspendPayload: slimPayload } })
    expect(view.flagged.map(c => c.id)).toEqual(['C2'])
  })

  it('reads a payload wrapped under its headline key (the current shape)', () => {
    const view = viewFromSteps({ 'human-review': { payload: input, suspendPayload: { 'Claim 1 of 1 (C2): claim C2': slimPayload } } })
    expect(view.flagged.map(c => c.id)).toEqual(['C2'])
    expect(view.decided).toEqual([{ claimId: 'C2', action: 'reject' }])
  })

  it('reads a run saved with the old full payload as it is', () => {
    const view = viewFromSteps({ 'human-review': { suspendPayload: payload } })
    expect(view.flagged).toEqual([])
  })

  it('throws when there is nothing to rebuild from, instead of showing an empty review', () => {
    expect(() => viewFromSteps({ 'human-review': { suspendPayload: slimPayload } })).toThrow()
  })
})
