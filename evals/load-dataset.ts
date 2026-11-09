// Copies evals/cases.ts into a Mastra dataset, so the cases can be browsed in Studio's Datasets
// page. cases.ts stays the source of truth (it is reviewed in git, and its history shows each set
// was labelled before it was first run). Safe to run again: items are keyed by case id, so a rerun
// adds only new cases.
//
//   npm run dataset
import { z } from 'zod'

const { mastra } = await import('../src/mastra')
const { cases } = await import('./cases')

const NAME = 'claim-check-cases'
const existing = await mastra.datasets.list({ filters: { name: NAME }, perPage: false })
const found = existing.datasets.find(d => d.name === NAME)

const dataset = found
  ? await mastra.datasets.get({ id: found.id })
  : await mastra.datasets.create({
      name: NAME,
      description: '42 hand-labelled drafts: planted false claims and true sentences. Split is in each item\'s metadata (dev, heldout, hard).',
      targetType: 'workflow',
      targetIds: ['claim-check'],
      scorerIds: ['falseClaimsCaught', 'trueClaimsNotFlagged'],
      inputSchema: z.object({ draft: z.string(), candidateId: z.string(), jobId: z.string() }),
    })

const items = await dataset.addItems({
  items: cases.map(c => ({
    externalId: c.id,
    input: { draft: c.draft, candidateId: 'eval-candidate', jobId: 'quillbeam-ai-engineer' },
    groundTruth: { ...c.truth, id: c.id },
    metadata: { split: c.split },
  })),
})
console.log(`${found ? 'Using' : 'Created'} dataset ${NAME} (${dataset.id}). Items now: ${items.length} of ${cases.length} cases.`)
