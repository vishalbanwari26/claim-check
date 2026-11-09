// Pure helpers for comparing two saved eval results. No Mastra, no network.

type Scored = { includes: string; type: string; outcome: string }

export type ResultRow = {
  round: number
  id: string
  status: 'scored' | 'errored'
  planted: Scored[]
  clean: Scored[]
}

export type Item = {
  key: string // "round|caseId|kind|includes": identifies the same item across two runs
  kind: 'planted' | 'clean'
  label: string // the text a human reads in the report
  outcome: string // caught | not_extracted | marked_supported | kept | false_flag
}

// Fail closed: only the known good outcomes count as right, so a new or misspelled outcome is wrong.
const RIGHT = new Set(['caught', 'kept'])

export const isWrong = (item: Item): boolean => !RIGHT.has(item.outcome)

// An errored row is saved with empty planted/clean lists, so it yields no items.
export const flattenRun = (run: { rows: ResultRow[] }): Item[] =>
  run.rows.flatMap(row => [
    ...row.planted.map(p => ({ key: `${row.round}|${row.id}|planted|${p.includes}`, kind: 'planted' as const, label: p.includes, outcome: p.outcome })),
    ...row.clean.map(c => ({ key: `${row.round}|${row.id}|clean|${c.includes}`, kind: 'clean' as const, label: c.includes, outcome: c.outcome })),
  ])

export type Comparison = {
  fixed: Item[] // wrong in A, right in B
  broke: Item[] // right in A, wrong in B
  unchanged: Item[] // same verdict in both (right in both, or wrong in both)
  notComparable: Item[] // present in only one of the two runs
}

export const compareItems = (a: Item[], b: Item[]): Comparison => {
  const bByKey = new Map(b.map(i => [i.key, i]))
  const aKeys = new Set(a.map(i => i.key))
  const out: Comparison = { fixed: [], broke: [], unchanged: [], notComparable: [] }

  for (const before of a) {
    const after = bByKey.get(before.key)
    if (!after) out.notComparable.push(before)
    else if (isWrong(before) && !isWrong(after)) out.fixed.push(after)
    else if (!isWrong(before) && isWrong(after)) out.broke.push(after)
    else out.unchanged.push(after)
  }
  out.notComparable.push(...b.filter(i => !aKeys.has(i.key)))
  return out
}

const list = (title: string, items: Item[]) =>
  items.length ? [`${title} (${items.length})`, ...items.map(i => `  ${i.label} (${i.outcome})`)] : []

export const formatComparison = (c: Comparison, verbose = false): string => {
  const stillWrong = c.unchanged.filter(isWrong)
  return [
    `fixed ${c.fixed.length}, broke ${c.broke.length}, still wrong ${stillWrong.length}, ok in both ${c.unchanged.length - stillWrong.length}, not comparable ${c.notComparable.length}`,
    ...list('FIXED', c.fixed),
    ...list('BROKE', c.broke),
    ...list('NOT COMPARABLE', c.notComparable),
    ...(verbose ? list('STILL WRONG', stillWrong) : []),
  ].join('\n')
}
