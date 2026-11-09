import { readFileSync } from 'node:fs'
import { compareItems, flattenRun, formatComparison } from '../src/mastra/compare'

const [labelA, labelB, ...flags] = process.argv.slice(2)
if (!labelA || !labelB) {
  console.error('usage: npm run compare -- <label-a> <label-b> [--verbose]')
  process.exit(2)
}

const load = (label: string) => JSON.parse(readFileSync(`evals/results/${label}.json`, 'utf8'))

const result = compareItems(flattenRun(load(labelA)), flattenRun(load(labelB)))
console.log(formatComparison(result, flags.includes('--verbose')))
process.exit(result.broke.length > 0 ? 1 : 0)
