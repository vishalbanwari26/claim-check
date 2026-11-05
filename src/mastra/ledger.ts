import { createHash } from 'node:crypto'
import { Memory } from '@mastra/memory'
import { z } from 'zod'
import { storage } from './storage'

// Persistent facts live in Mastra working memory, scoped to the candidate.
//
// No agent has this Memory attached. An agent with working memory gets an
// updateWorkingMemory tool by default, and then a model can write "the user said X". Here
// the only code that writes a confirmed fact is the human review step.
//
// Human facts and agent inferences sit under separate resource ids, so reading one can
// never return the other.
export const factMemory = new Memory({
  storage,
  options: { workingMemory: { enabled: true, scope: 'resource', agentManaged: false } },
})

const confirmedFact = z.object({
  id: z.string(),
  text: z.string(),
  source: z.enum(['human-correction', 'human-approval']),
  confirmedBy: z.string().min(1),
  confirmedAt: z.string(),
  runId: z.string(),
  originClaim: z.string(),
  retracted: z.object({ by: z.string(), at: z.string(), reason: z.string() }).optional(),
})
export type ConfirmedFact = z.infer<typeof confirmedFact>

const inference = z.object({
  runId: z.string(),
  claimId: z.string(),
  claimText: z.string(),
  verdict: z.string(),
  reason: z.string(),
  at: z.string(),
})
export type Inference = z.infer<typeof inference>

// The method needs a thread id even though resource scope ignores it.
const THREAD = 'ledger'
const confirmedResource = (candidateId: string) => candidateId
const inferredResource = (candidateId: string) => `${candidateId}:agent-inferred`

const read = async <T>(resourceId: string, schema: z.ZodType<T>): Promise<T[]> => {
  const raw = await factMemory.getWorkingMemory({ threadId: THREAD, resourceId })
  return raw ? z.array(schema).parse(JSON.parse(raw)) : []
}

const write = (resourceId: string, rows: unknown[]) =>
  factMemory.updateWorkingMemory({ threadId: THREAD, resourceId, workingMemory: JSON.stringify(rows) })

// Everything ever confirmed, including retracted facts. For showing the record, not for evidence.
export const readAllConfirmed = (candidateId: string) => read(confirmedResource(candidateId), confirmedFact)
// What counts as evidence: confirmed by a human and not retracted since.
export const readConfirmed = async (candidateId: string) => (await readAllConfirmed(candidateId)).filter(f => !f.retracted)
export const readInferred = (candidateId: string) => read(inferredResource(candidateId), inference)

const factId = (text: string) =>
  `H-${createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 6)}`

// Same text gives the same id, so resuming twice or correcting twice adds one fact. Confirming
// a retracted text again adds a new row, which leaves the old record as it was.
export const addConfirmed = async (
  candidateId: string,
  fact: Omit<ConfirmedFact, 'id' | 'confirmedAt' | 'retracted'>,
): Promise<ConfirmedFact> => {
  const rows = await readAllConfirmed(candidateId)
  const id = factId(fact.text)
  const existing = rows.find(r => r.id === id && !r.retracted)
  if (existing) return existing
  const row = confirmedFact.parse({ ...fact, id, confirmedAt: new Date().toISOString() })
  await write(confirmedResource(candidateId), [...rows, row])
  return row
}

// Marks a wrong fact instead of deleting it, so the record of who approved it, and who took
// it back, survives. Only the CLI calls this: no agent, tool or workflow step can.
export const retractConfirmed = async (
  candidateId: string,
  id: string,
  { by, reason }: { by: string; reason: string },
): Promise<ConfirmedFact> => {
  if (!by.trim()) throw new Error('Retracting a fact needs a name.')
  if (!reason.trim()) throw new Error('Retracting a fact needs a reason.')
  const rows = await readAllConfirmed(candidateId)
  const row = rows.find(r => r.id === id && !r.retracted)
  if (!row) throw new Error(`No active fact ${id} for ${candidateId}.`)
  row.retracted = { by, reason, at: new Date().toISOString() }
  await write(confirmedResource(candidateId), rows)
  return row
}

export const addInferred = async (candidateId: string, items: Omit<Inference, 'at'>[]) => {
  if (items.length === 0) return
  const rows = await readInferred(candidateId)
  const at = new Date().toISOString()
  await write(inferredResource(candidateId), [...rows, ...items.map(i => ({ ...i, at }))])
}
