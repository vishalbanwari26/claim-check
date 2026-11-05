// Runs the real workflow on the real model and the real GitHub API. It stops at the human
// step, which is what we want: the scorers read the flag step, which is the last thing the
// agent decides before a person gets involved.
//
//   npm run evals -- --split dev --rounds 3 --pace 12
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { runEvals } from '@mastra/core/evals'

const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'dev' },
    rounds: { type: 'string', default: '1' },
    pace: { type: 'string', default: '12' },
    label: { type: 'string', default: '' },
    studio: { type: 'boolean', default: false },
  },
})
const rounds = Number(values.rounds)
const paceMs = Number(values.pace) * 1000

// Evals get a throwaway database, so they can never touch the real confirmed facts. With
// --studio they use the main one, so the runs and scores show up in Studio. That is still
// safe, because the eval candidate has its own memory.
if (!values.studio) {
  mkdirSync('.data', { recursive: true })
  for (const suffix of ['', '-shm', '-wal']) rmSync(`.data/evals.db${suffix}`, { force: true })
  process.env.CLAIM_CHECK_DB = 'file:.data/evals.db'
}

const { mastra } = await import('../src/mastra')
const { falseClaimsCaught, scoreCase, trueClaimsNotFlagged } = await import('../src/mastra/scorers')
const { cases } = await import('./cases')

const selected = cases.filter(c => values.split === 'all' || c.split === values.split)
console.log(`${selected.length} cases, ${rounds} round(s), model ${process.env.CLAIM_CHECK_MODEL ?? 'groq/openai/gpt-oss-120b'}`)

type Row = { round: number; id: string; status: 'scored' | 'errored'; planted: ReturnType<typeof scoreCase>['planted']; clean: ReturnType<typeof scoreCase>['clean']; claims?: unknown; error?: string }
const rows: Row[] = []
const official: unknown[] = []

for (let round = 1; round <= rounds; round++) {
  const result = await runEvals({
    target: mastra.getWorkflow('claim-check'),
    data: selected.map(c => ({
      input: { draft: c.draft, candidateId: 'eval-candidate', jobId: 'quillbeam-ai-engineer' },
      groundTruth: { ...c.truth, id: c.id },
    })),
    scorers: { steps: { 'flag-claims': [falseClaimsCaught, trueClaimsNotFlagged] } },
    concurrency: 1,
    onItemComplete: async ({ item, targetResult }) => {
      const truth = item.groundTruth as (typeof cases)[number]['truth'] & { id: string }
      const steps = (targetResult as any).scoringData?.stepResults ?? {}
      const flag = steps['flag-claims']
      // runEvals skips step scorers when the step failed, so a rate-limited case would
      // vanish from the average. Count those here instead.
      if (flag?.status === 'success') {
        const { planted, clean } = scoreCase(flag.output, truth)
        rows.push({ round, id: truth.id, status: 'scored', planted, clean, claims: flag.output.claims.map((c: any) => ({ text: c.text, verdict: c.agentVerdict, reason: c.agentReason })) })
      } else {
        const failed = Object.entries<any>(steps).find(([, s]) => s.status === 'failed')
        rows.push({ round, id: truth.id, status: 'errored', planted: [], clean: [], error: String(failed?.[1]?.error?.message ?? failed?.[1]?.error ?? 'unknown').slice(0, 200) })
      }
      const last = rows.at(-1)!
      const wrong = [...last.planted.filter(p => p.outcome !== 'caught'), ...last.clean.filter(c => c.outcome !== 'kept')]
      console.log(`round ${round} ${truth.id}: ${last.status}${wrong.length ? ` WRONG ${wrong.map(w => w.outcome).join(', ')}` : ''}`)
      await sleep(paceMs)
    },
  })
  official.push(result.scores)
  console.log(`round ${round} runEvals scores: ${JSON.stringify(result.scores)}`)
}

const scored = rows.filter(r => r.status === 'scored')
const pct = (a: number, b: number) => `${a}/${b}${b ? ` (${Math.round((100 * a) / b)}%)` : ''}`
const types = [...new Set(scored.flatMap(r => [...r.planted, ...r.clean].map(x => x.type)))]

console.log(`\nSplit ${values.split}. Scored ${scored.length} of ${rows.length} case runs. Errored: ${rows.length - scored.length}.`)
console.log('\nFalse claims caught, by type:')
for (const t of types) {
  const p = scored.flatMap(r => r.planted).filter(x => x.type === t)
  if (p.length) console.log(`  ${t.padEnd(10)} ${pct(p.filter(x => x.outcome === 'caught').length, p.length)}`)
}
const allPlanted = scored.flatMap(r => r.planted)
const allClean = scored.flatMap(r => r.clean)
console.log(`  ${'TOTAL'.padEnd(10)} ${pct(allPlanted.filter(x => x.outcome === 'caught').length, allPlanted.length)}`)
console.log(`\nTrue sentences not flagged: ${pct(allClean.filter(x => x.outcome === 'kept').length, allClean.length)}`)

console.log('\nEvery miss:')
for (const r of scored) {
  for (const p of r.planted.filter(x => x.outcome !== 'caught')) console.log(`  round ${r.round} ${r.id}: ${p.outcome}: "${p.includes}"`)
  for (const c of r.clean.filter(x => x.outcome !== 'kept')) console.log(`  round ${r.round} ${r.id}: false flag: ${c.claim}`)
}
for (const r of rows.filter(x => x.status === 'errored')) console.log(`  round ${r.round} ${r.id}: errored: ${r.error}`)

mkdirSync('evals/results', { recursive: true })
const file = `evals/results/${values.split}${values.label ? `-${values.label}` : ''}.json`
writeFileSync(file, JSON.stringify({ split: values.split, rounds, model: process.env.CLAIM_CHECK_MODEL ?? 'groq/openai/gpt-oss-120b', official, rows }, null, 2))
console.log(`\nSaved ${file}`)
