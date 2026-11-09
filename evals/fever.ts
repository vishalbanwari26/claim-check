// Runs the real workflow on a sample of FEVER, a public fact-verification benchmark, to see how
// the claim checker does on cases nobody here wrote. Needs the rows fetched into .data/fever (see
// the README). FEVER claims and evidence are CC BY-SA 3.0 (Wikipedia), so the data stays out of git.
//
// This measures the evidence checker, not the whole workflow. The claim extractor is written for
// job applications and extracts nothing from most FEVER sentences (3 of 6 in a trial run), so
// running the whole workflow would mostly measure that. The claim goes straight to the same checker
// agent, with the same prompt and the same verdict rules (judgeClaims) as the real workflow.
//
// Each FEVER item becomes one check. The claim is the draft, and the candidate's confirmed facts are
// the item's evidence sentences plus four sentences from other items as distractors. For NOT ENOUGH
// INFO items the dataset's evidence is related text that does not settle the claim.
//
//   npm run fever -- --n 50 --pace 8
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { checkerOutput } from '../src/mastra/schemas'

const { values } = parseArgs({
  options: { n: { type: 'string', default: '50' }, pace: { type: 'string', default: '8' }, seed: { type: 'string', default: '1' } },
})
const n = Number(values.n)

mkdirSync('.data/fever/candidates', { recursive: true })
for (const f of readdirSync('.data/fever/candidates')) rmSync(`.data/fever/candidates/${f}`)
// A throwaway database, and the facts read from the per-item files, so a benchmark can never touch
// the real confirmed facts.
for (const suffix of ['', '-shm', '-wal']) rmSync(`.data/fever-run.db${suffix}`, { force: true })
process.env.CLAIM_CHECK_DB = 'file:.data/fever-run.db'
process.env.CLAIM_CHECK_CANDIDATES_DIR = '.data/fever/candidates'

type Row = { claim: string; label: 'SUPPORTS' | 'REFUTES' | 'NOT ENOUGH INFO'; evidence: string[][]; id: string }
const LABELS = ['SUPPORTS', 'REFUTES', 'NOT ENOUGH INFO'] as const
type Label = (typeof LABELS)[number] | 'NO_CLAIM'

// A small seeded generator, so the same --seed picks the same items.
let state = Number(values.seed) * 2654435761 % 2 ** 32
const random = () => ((state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)
const shuffle = <T>(xs: T[]) => xs.map(x => [random(), x] as const).sort((a, b) => a[0] - b[0]).map(p => p[1])

const rows = readdirSync('.data/fever').filter(f => /^p\d+\.json$/.test(f))
  .flatMap(f => (JSON.parse(readFileSync(`.data/fever/${f}`, 'utf8')).rows as { row: Row }[]).map(r => r.row))
const unique = [...new Map(rows.map(r => [r.id, r])).values()]

const title = (t: string) => t.replace(/_/g, ' ').replace(/-LRB-/g, '(').replace(/-RRB-/g, ')').replace(/-COLON-/g, ':')
const sentenceOf = (e: string[]) => `${title(e[0])}: ${e[2]}`.replace(/ -LRB- /g, ' (').replace(/ -RRB-/g, ')')
const withEvidence = unique.filter(r => r.evidence.length > 0 && r.evidence.every(e => e[2]))
const pool = withEvidence.flatMap(r => r.evidence.map(e => ({ id: r.id, text: sentenceOf(e) })))

const perLabel = Math.ceil(n / 3)
const sample = LABELS.flatMap(label => shuffle(unique.filter(r => r.label === label && (label === 'NOT ENOUGH INFO' || r.evidence.every(e => e[2])))).slice(0, perLabel)).slice(0, n)
console.log(`FEVER sample: ${sample.length} items from ${unique.length} rows, ${LABELS.map(l => `${sample.filter(r => r.label === l).length} ${l}`).join(', ')}`)

const { mastra } = await import('../src/mastra')
const { checkerPrompt, judgeClaims } = await import('../src/mastra/logic')
const { readConfirmedFacts, readJobAd } = await import('../src/mastra/tools')

const predictFrom = (claims: { agentVerdict: string }[]): Label => {
  if (claims.length === 0) return 'NO_CLAIM'
  if (claims.some(c => c.agentVerdict === 'contradicted')) return 'REFUTES'
  if (claims.every(c => c.agentVerdict === 'supported')) return 'SUPPORTS'
  return 'NOT ENOUGH INFO'
}

const details: unknown[] = []
type Result = { id: string; truth: Row['label']; predicted: Label | 'ERRORED'; verdicts: string[]; error?: string }
const results: Result[] = []

for (const [i, item] of sample.entries()) {
  const distractors = shuffle(pool.filter(p => p.id !== item.id)).slice(0, 4)
  const gold = item.evidence.map(e => ({ id: item.id, text: sentenceOf(e) }))
  const facts = shuffle([...gold, ...distractors]).map((f, k) => ({ id: `F${k + 1}`, text: f.text }))
  const candidateId = `fever-${i}`
  writeFileSync(`.data/fever/candidates/${candidateId}.json`, JSON.stringify({ name: candidateId, facts, projects: [] }))
  try {
    const { facts: stored } = (await readConfirmedFacts.execute!({ candidateId }, {})) as { facts: { id: string; text: string }[] }
    const { text: jobAd } = (await readJobAd.execute!({ jobId: 'quillbeam-ai-engineer' }, {})) as { text: string }
    const evidence = [...stored.map(f => ({ id: f.id, text: f.text })), { id: 'JOB', text: jobAd }]
    const claim = { id: 'C1', text: item.claim, kind: 'general' as const, repoRef: null, statedLanguage: null, sentence: 1, sentenceText: item.claim }
    const { object } = await mastra.getAgent('evidenceChecker').generate(checkerPrompt(evidence, [claim]), {
      modelSettings: { temperature: 0 }, structuredOutput: { schema: checkerOutput },
    })
    const judged = judgeClaims([claim], object.verdicts, {}, evidence)
    results.push({ id: item.id, truth: item.label, predicted: predictFrom(judged), verdicts: judged.map(c => c.agentVerdict) })
    details.push({ id: item.id, truth: item.label, claim: item.claim, facts, verdicts: judged.map(c => ({ verdict: c.agentVerdict, reason: c.agentReason, cited: c.citedEvidence.map(e => e.id) })) })
  } catch (e) {
    results.push({ id: item.id, truth: item.label, predicted: 'ERRORED', verdicts: [], error: String((e as Error).message ?? e).slice(0, 200) })
  }
  const r = results.at(-1)!
  console.log(`${i + 1}/${sample.length} ${r.truth} -> ${r.predicted}${r.predicted === r.truth ? '' : '  WRONG'}`)
  await sleep(Number(values.pace) * 1000)
}

const scored = results.filter(r => r.predicted !== 'ERRORED')
const right = scored.filter(r => r.predicted === r.truth).length
console.log(`\nAccuracy ${right}/${scored.length} (${Math.round((100 * right) / Math.max(scored.length, 1))}%). Errored runs: ${results.length - scored.length}.`)
for (const l of LABELS) {
  const of = scored.filter(r => r.truth === l)
  console.log(`  ${l.padEnd(16)} recall ${of.filter(r => r.predicted === l).length}/${of.length}   predicted as: ${[...new Set(of.map(r => r.predicted))].map(p => `${p} ${of.filter(r => r.predicted === p).length}`).join(', ')}`)
}
// The part that matches claim-check's job: did a false claim end up flagged? Anything not SUPPORTS is flagged.
const refuted = scored.filter(r => r.truth === 'REFUTES')
const supports = scored.filter(r => r.truth === 'SUPPORTS')
console.log(`\nRefuted claims flagged: ${refuted.filter(r => r.predicted !== 'SUPPORTS').length}/${refuted.length}. Supported claims left alone: ${supports.filter(r => r.predicted === 'SUPPORTS').length}/${supports.length}.`)

mkdirSync('evals/results', { recursive: true })
const file = `evals/results/fever-${sample.length}.json`
writeFileSync(file, JSON.stringify({ benchmark: 'FEVER (copenlu/fever_gold_evidence, validation)', seed: Number(values.seed), model: process.env.CLAIM_CHECK_MODEL ?? 'groq/openai/gpt-oss-120b', results }, null, 2))
console.log(`Saved ${file}`)
// The claim and evidence text is CC BY-SA, so it goes in .data (not in git), for reading the misses.
writeFileSync('.data/fever/details.json', JSON.stringify(details, null, 2))
