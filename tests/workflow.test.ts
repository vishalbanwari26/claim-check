// The whole workflow against a real database, with a fake model. Lets us state exactly what
// the model answers, including answers that try to break the rules.
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import { MastraLanguageModelV2Mock, simulateReadableStream } from '@mastra/core/test-utils/llm-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAllConfirmed, readConfirmed, readInferred, retractConfirmed } from '../src/mastra/ledger'
import { viewFromSteps } from '../src/mastra/review'
import { type Report } from '../src/mastra/schemas'
import { reviewUrl, unwrapSuspend } from '../src/mastra/view'
import { storage } from '../src/mastra/storage'
import { readConfirmedFacts } from '../src/mastra/tools'
import { claimCheck } from '../src/mastra/workflows/claim-check'

const promptText = (options: any) =>
  options.prompt.flatMap((m: any) => (Array.isArray(m.content) ? m.content.map((p: any) => p.text ?? '') : [m.content])).join('\n')

const fakeModel = (answer: (prompt: string) => unknown, seen: string[] = []) => {
  const respond = (options: any) => {
    const prompt = promptText(options)
    seen.push(prompt)
    return JSON.stringify(answer(prompt))
  }
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
  return new MastraLanguageModelV2Mock({
    doGenerate: (async (options: any) => ({
      content: [{ type: 'text', text: respond(options) }], finishReason: 'stop', usage, warnings: [],
    })) as any,
    doStream: (async (options: any) => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'response-metadata', id: 'r', modelId: 'fake', timestamp: new Date(0) },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: respond(options) },
          { type: 'text-end', id: 't' },
          { type: 'finish', finishReason: 'stop', usage },
        ] as any,
      }),
    })) as any,
  })
}

const CORRECTION = 'Worked with clinics by call, never on site.'
const draft = [
  'I was a support engineer at Tandvik Software.',
  'I fixed problems on site at clinics.',
  'Nobody asked me to build the retry service.',
  'I wrote linguist in Python.',
  'I care about honest tools.',
].join(' ')

const extraction = {
  claims: [
    { sentence: 1, text: 'I was a support engineer at Tandvik Software.', kind: 'general', repoRef: null, statedLanguage: null },
    { sentence: 2, text: 'I fixed problems on site at clinics.', kind: 'general', repoRef: null, statedLanguage: null },
    { sentence: 3, text: 'Nobody asked me to build the retry service.', kind: 'general', repoRef: null, statedLanguage: null },
    { sentence: 4, text: 'I wrote linguist in Python.', kind: 'repo-language', repoRef: 'linguist', statedLanguage: 'Python' },
  ],
}

// Behaves like a checker that reads its evidence: it can only cite the correction if the
// correction was in the prompt.
const checkerAnswer = (prompt: string) => {
  const correctionId = prompt.match(/\[(H-\w+)\] Worked with clinics by call/)?.[1]
  return {
    verdicts: [
      { claimId: 'C1', verdict: 'supported', citedIds: ['F1'], reason: 'F1 says so.' },
      correctionId
        ? { claimId: 'C2', verdict: 'contradicted', citedIds: [correctionId], reason: 'The correction says never on site.' }
        : { claimId: 'C2', verdict: 'no_evidence', citedIds: [], reason: 'AGENT-GUESS-ON-SITE-UNKNOWN' },
      { claimId: 'C3', verdict: 'contradicted', citedIds: ['F3'], reason: 'F3 says it was assigned.' },
    ],
  }
}

const buildMastra = (seen: string[] = [], answer = checkerAnswer) =>
  new Mastra({
    storage,
    logger: false,
    agents: {
      claimExtractor: new Agent({ id: 'x', name: 'x', instructions: 'x', model: fakeModel(() => extraction) }),
      evidenceChecker: new Agent({ id: 'c', name: 'c', instructions: 'c', model: fakeModel(answer, seen) }),
    },
    workflows: { 'claim-check': claimCheck },
  })

const startRun = async (mastra: Mastra, candidateId: string) => {
  const run = await mastra.getWorkflow('claim-check').createRun()
  const result = await run.start({ inputData: { draft, candidateId, jobId: 'quillbeam-ai-engineer' } })
  return { run, result }
}

// What the CLI and the review page read: every claim, rebuilt from the step.
const payload = (result: any) => viewFromSteps(result.steps)
// What Studio prints: one claim in plain words.
const slim = (result: any) => unwrapSuspend(result.steps['human-review'].suspendPayload)

// The tools need a file per candidate, so tests use the real invented one and a fresh
// resource each time would need a new file. Instead each test clears the ledger.
const CANDIDATE = 'ines-varga'
const clearLedger = async () => {
  const { factMemory } = await import('../src/mastra/ledger')
  await factMemory.updateWorkingMemory({ threadId: 'ledger', resourceId: CANDIDATE, workingMemory: '[]' })
  await factMemory.updateWorkingMemory({ threadId: 'ledger', resourceId: `${CANDIDATE}:agent-inferred`, workingMemory: '[]' })
}

beforeEach(async () => {
  await storage.init()
  await clearLedger()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ language: 'Ruby' }), { status: 200 })))
})

describe('the run stops for a human', () => {
  it('suspends with the flagged claims and nothing verified', async () => {
    const { result } = await startRun(buildMastra(), CANDIDATE)
    expect(result.status).toBe('suspended')
    const p = payload(result)
    expect(p.flagged.map(c => [c.id, c.agentVerdict])).toEqual([['C2', 'no_evidence'], ['C3', 'contradicted'], ['C4', 'contradicted']])
    expect(p.supportedAwaitingApproval.map(c => c.id)).toEqual(['C1'])
    expect(p.uncheckedSentences.map(s => s.text)).toEqual(['I care about honest tools.'])
    expect(await readConfirmed(CANDIDATE)).toEqual([])
  })

  it('still stops when every claim looks fine', async () => {
    const mastra = buildMastra([], () => ({
      verdicts: ['C1', 'C2', 'C3'].map(claimId => ({ claimId, verdict: 'supported', citedIds: ['F1'], reason: 'r' })),
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ language: 'Python' }), { status: 200 })))
    const { result } = await startRun(mastra, CANDIDATE)
    expect(result.status).toBe('suspended')
    expect(payload(result).flagged).toEqual([])
  })
})

describe('resuming', () => {
  const decisions = [
    { claimId: 'C2', action: 'correct' as const, correctedFact: CORRECTION },
    { claimId: 'C3', action: 'reject' as const },
    { claimId: 'C4', action: 'reject' as const },
  ]

  it('a partial answer stays suspended, keeps what was decided, and writes nothing', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    const r1 = await run.resume({
      step: 'human-review',
      resumeData: { reviewer: 'ines', approveSupported: true, decisions: [decisions[0], { claimId: 'C99', action: 'approve' }] },
    })
    expect(r1.status).toBe('suspended')
    const p = payload(r1)
    expect(p.decided.map(d => d.claimId)).toEqual(['C2'])
    expect(p.problems).toEqual(expect.arrayContaining(['C99 is not a flagged claim.', 'C3 still needs a decision.']))
    expect(await readConfirmed(CANDIDATE)).toEqual([])

    const r2 = await run.resume({ step: 'human-review', resumeData: { reviewer: 'ines', approveSupported: true, decisions: decisions.slice(1) } })
    expect(r2.status).toBe('success')
  })

  it('a run can be resumed from a new Mastra instance using only its id', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    const later = buildMastra().getWorkflow('claim-check')
    const state = await later.getWorkflowRunById(run.runId)
    expect(state?.status).toBe('suspended')
    const resumed = await later.createRun({ runId: run.runId })
    const result = await resumed.resume({ step: 'human-review', resumeData: { reviewer: 'ines', approveSupported: false, decisions } })
    expect(result.status).toBe('success')
  })

  it('reports each status and who decided', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    const result = await run.resume({ step: 'human-review', resumeData: { reviewer: 'ines', approveSupported: false, decisions } })
    const report = (result as any).result as Report
    expect(report.claims.map(c => [c.id, c.status])).toEqual([['C1', 'not_verified'], ['C2', 'corrected'], ['C3', 'rejected'], ['C4', 'rejected']])
    expect(report.claims[0].decidedBy).toBeNull()
    expect(report.claims[1].decidedBy).toBe('ines')
  })
})

describe('memory', () => {
  const finish = async (mastra: Mastra) => {
    const { run } = await startRun(mastra, CANDIDATE)
    return run.resume({
      step: 'human-review',
      resumeData: {
        reviewer: 'ines',
        approveSupported: false,
        decisions: [
          { claimId: 'C2', action: 'correct', correctedFact: CORRECTION },
          { claimId: 'C3', action: 'reject' },
          { claimId: 'C4', action: 'approve' },
        ],
      },
    })
  }

  it('saves a correction with human provenance and uses it on the next run', async () => {
    await finish(buildMastra())
    const facts = await readConfirmed(CANDIDATE)
    const correction = facts.find(f => f.text === CORRECTION)!
    expect(correction).toMatchObject({ source: 'human-correction', confirmedBy: 'ines', originClaim: 'I fixed problems on site at clinics.' })

    const seen: string[] = []
    const { result } = await startRun(buildMastra(seen), CANDIDATE)
    expect(seen[0]).toContain(CORRECTION)
    const c2 = payload(result).flagged.find(c => c.id === 'C2')!
    expect(c2.agentVerdict).toBe('contradicted')
    expect(c2.citedEvidence.map(e => e.id)).toEqual([correction.id])
  })

  it('records an approval differently from a correction, and rejects write nothing', async () => {
    await finish(buildMastra())
    const facts = await readConfirmed(CANDIDATE)
    expect(facts.map(f => f.source).sort()).toEqual(['human-approval', 'human-correction'])
    expect(facts.some(f => f.text.includes('Nobody asked'))).toBe(false)
  })

  it('does not duplicate a fact confirmed twice', async () => {
    await finish(buildMastra())
    await finish(buildMastra())
    expect((await readConfirmed(CANDIDATE)).filter(f => f.text === CORRECTION)).toHaveLength(1)
  })

  it('keeps agent inferences out of the evidence', async () => {
    await startRun(buildMastra(), CANDIDATE)
    const inferred = await readInferred(CANDIDATE)
    expect(inferred.some(i => i.reason === 'AGENT-GUESS-ON-SITE-UNKNOWN')).toBe(true)
    expect(await readConfirmed(CANDIDATE)).toEqual([])

    const tool = await readConfirmedFacts.execute!({ candidateId: CANDIDATE }, {})
    expect(JSON.stringify(tool)).not.toContain('AGENT-GUESS')

    const seen: string[] = []
    await startRun(buildMastra(seen), CANDIDATE)
    expect(seen[0]).not.toContain('AGENT-GUESS')
  })

  const correctionId = async () => (await readConfirmed(CANDIDATE)).find(f => f.text === CORRECTION)!.id
  const retract = { by: 'ines', reason: 'Approved by mistake' }

  it('stops using a retracted fact as evidence, on the next run', async () => {
    await finish(buildMastra())
    await retractConfirmed(CANDIDATE, await correctionId(), retract)

    expect((await readConfirmed(CANDIDATE)).some(f => f.text === CORRECTION)).toBe(false)
    const tool = await readConfirmedFacts.execute!({ candidateId: CANDIDATE }, {})
    expect(JSON.stringify(tool)).not.toContain(CORRECTION)

    const seen: string[] = []
    await startRun(buildMastra(seen), CANDIDATE)
    expect(seen[0]).not.toContain(CORRECTION)
  })

  it('keeps the retracted fact on record, with who, when and why', async () => {
    await finish(buildMastra())
    await retractConfirmed(CANDIDATE, await correctionId(), retract)
    const row = (await readAllConfirmed(CANDIDATE)).find(f => f.text === CORRECTION)!
    expect(row).toMatchObject({ confirmedBy: 'ines', retracted: retract })
    expect(row.retracted!.at).toBeTruthy()
  })

  it('refuses an unknown id, an already retracted fact, and a missing name or reason', async () => {
    await finish(buildMastra())
    const id = await correctionId()
    await expect(retractConfirmed(CANDIDATE, 'H-000000', retract)).rejects.toThrow(/No active fact/)
    await expect(retractConfirmed(CANDIDATE, id, { by: ' ', reason: 'x' })).rejects.toThrow(/name/)
    await expect(retractConfirmed(CANDIDATE, id, { by: 'ines', reason: '' })).rejects.toThrow(/reason/)
    expect((await readConfirmed(CANDIDATE)).some(f => f.id === id)).toBe(true)
    await retractConfirmed(CANDIDATE, id, retract)
    await expect(retractConfirmed(CANDIDATE, id, retract)).rejects.toThrow(/No active fact/)
  })

  it('lets a human confirm the same text again, keeping the old record', async () => {
    await finish(buildMastra())
    await retractConfirmed(CANDIDATE, await correctionId(), retract)
    await finish(buildMastra())
    expect((await readConfirmed(CANDIDATE)).filter(f => f.text === CORRECTION)).toHaveLength(1)
    expect((await readAllConfirmed(CANDIDATE)).filter(f => f.text === CORRECTION)).toHaveLength(2)
  })
})

describe('a model that misbehaves', () => {
  it('retries a step when the provider rejects the output', async () => {
    let calls = 0
    const mastra = buildMastra([], prompt => {
      if (++calls === 1) throw new Error('Generated JSON does not match the expected schema')
      return checkerAnswer(prompt)
    })
    const { result } = await startRun(mastra, CANDIDATE)
    expect(calls).toBe(2)
    expect(result.status).toBe('suspended')
  })

  it('fails the run and verifies nothing when every attempt fails', async () => {
    const mastra = buildMastra([], () => {
      throw new Error('Generated JSON does not match the expected schema')
    })
    const { result } = await startRun(mastra, CANDIDATE)
    expect(result.status).toBe('failed')
    expect(await readConfirmed(CANDIDATE)).toEqual([])
  })

  it('cannot verify a claim by citing evidence that does not exist', async () => {
    const mastra = buildMastra([], () => ({
      verdicts: ['C1', 'C2', 'C3'].map(claimId => ({ claimId, verdict: 'supported', citedIds: ['F404'], reason: 'Believe me.' })),
    }))
    const { result } = await startRun(mastra, CANDIDATE)
    expect(payload(result).supportedAwaitingApproval).toEqual([])
    expect(payload(result).flagged).toHaveLength(4)
  })

  it('ends up flagged when GitHub is rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    const { result } = await startRun(buildMastra(), CANDIDATE)
    expect(payload(result).flagged.find(c => c.id === 'C4')?.agentVerdict).toBe('could_not_check')
  })
})

describe('the pause shown in Studio', () => {
  const body = (result: any) => Object.values(result.steps['human-review'].suspendPayload)[0] as Record<string, unknown>

  it('titles the pause briefly and puts the review page address in the body', async () => {
    const { run, result } = await startRun(buildMastra(), CANDIDATE)
    expect(Object.keys(result.steps['human-review'].suspendPayload)).toEqual(['Decide 3 claims on the review page'])
    expect(body(result)).toEqual({ reviewUrl: reviewUrl(run.runId) })
  })

  it('resuming with only a name decides nothing', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    const r = await run.resume({ step: 'human-review', resumeData: { reviewer: 'ines' } })
    expect(r.status).toBe('suspended')
    expect(slim(r).problems).toEqual(['C2 still needs a decision.', 'C3 still needs a decision.', 'C4 still needs a decision.'])
  })

  it('refuses a correction with no text', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    const r = await run.resume({ step: 'human-review', resumeData: { reviewer: 'ines', decisions: [{ claimId: 'C2', action: 'correct' }] } })
    expect(r.status).toBe('suspended')
    expect(slim(r).problems).toEqual(expect.arrayContaining(['C2: "correct" needs correctedFact.']))
  })

  it('refuses a different reviewer name part way through, so facts are credited correctly', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    await run.resume({ step: 'human-review', resumeData: { reviewer: 'ines', decisions: [{ claimId: 'C2', action: 'reject' }] } })
    const r = await run.resume({ step: 'human-review', resumeData: { reviewer: 'marco', decisions: [{ claimId: 'C3', action: 'reject' }] } })
    expect(r.status).toBe('suspended')
    expect(slim(r).problems[0]).toContain('started by ines')
    expect(slim(r).decided.map(d => d.claimId)).toEqual(['C2'])
  })

  it('treats the same name in another case as the same reviewer', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    await run.resume({ step: 'human-review', resumeData: { reviewer: 'Ines', decisions: [{ claimId: 'C2', action: 'reject' }] } })
    const rest = ['C3', 'C4'].map(claimId => ({ claimId, action: 'reject' as const }))
    const r = await run.resume({ step: 'human-review', resumeData: { reviewer: ' ines ', decisions: rest } })
    expect(r.status).toBe('success')
  })

  it('still accepts a decisions list and approveSupported, for the CLI and the page', async () => {
    const { run } = await startRun(buildMastra(), CANDIDATE)
    const decisions = [{ claimId: 'C2', action: 'reject' as const }, { claimId: 'C3', action: 'reject' as const }, { claimId: 'C4', action: 'reject' as const }]
    const r = await run.resume({ step: 'human-review', resumeData: { reviewer: 'ines', approveSupported: true, decisions } })
    expect(r.status).toBe('success')
    expect(((r as any).result as Report).claims[0].status).toBe('verified')
  })
})

const result1Title = (r: any) => r.steps['human-review'].suspendPayload
