import { describe, expect, it } from 'vitest'
import { compareItems, flattenRun, formatComparison, isWrong } from '../src/mastra/compare'
import type { Item, ResultRow } from '../src/mastra/compare'

const row = (over: Partial<ResultRow>): ResultRow => ({ round: 1, id: 'case-a', status: 'scored', planted: [], clean: [], ...over })

describe('flattenRun', () => {
  it('makes one item per planted claim and per clean sentence', () => {
    const items = flattenRun({ rows: [row({
      planted: [{ includes: 'office in Oslo', type: 'location', outcome: 'caught' }],
      clean: [{ includes: 'Berlin', type: 'location', outcome: 'kept' }],
    })] })
    expect(items.map(i => [i.key, i.outcome])).toEqual([
      ['1|case-a|planted|office in Oslo', 'caught'],
      ['1|case-a|clean|Berlin', 'kept'],
    ])
  })

  it('gives an errored row zero items', () => {
    expect(flattenRun({ rows: [row({ status: 'errored' })] })).toEqual([])
  })
})

const item = (outcome: string): Item => ({ key: 'k', kind: 'planted', label: 'l', outcome })

describe('isWrong', () => {
  it.each(['not_extracted', 'marked_supported', 'false_flag'])('%s is wrong', o => expect(isWrong(item(o))).toBe(true))
  it.each(['caught', 'kept'])('%s is right', o => expect(isWrong(item(o))).toBe(false))
  it('fails closed on an outcome it does not know', () => expect(isWrong(item('extracted_but_unclear'))).toBe(true))
})

const mk = (key: string, outcome: string): Item => ({ key, kind: 'planted', label: key, outcome })

describe('compareItems', () => {
  it('sorts items into four buckets', () => {
    const a = [mk('1', 'not_extracted'), mk('2', 'caught'), mk('3', 'caught'), mk('4', 'caught')]
    const b = [mk('1', 'caught'), mk('2', 'marked_supported'), mk('3', 'caught'), mk('5', 'caught')]
    const r = compareItems(a, b)
    expect(r.fixed.map(i => i.key)).toEqual(['1'])
    expect(r.broke.map(i => i.key)).toEqual(['2'])
    expect(r.unchanged.map(i => i.key)).toEqual(['3'])
    expect(r.notComparable.map(i => i.key)).toEqual(['4', '5'])
  })

  it('keeps a different failure in the unchanged bucket', () => {
    const r = compareItems([mk('1', 'not_extracted')], [mk('1', 'marked_supported')])
    expect(r.unchanged).toHaveLength(1)
    expect(r.fixed.length + r.broke.length).toBe(0)
  })
})

describe('formatComparison', () => {
  it('always counts still-wrong, lists it only when verbose', () => {
    const c = compareItems([mk('1', 'not_extracted'), mk('2', 'caught')], [mk('1', 'not_extracted'), mk('2', 'caught')])
    expect(formatComparison(c)).toBe('fixed 0, broke 0, still wrong 1, ok in both 1, not comparable 0')
    expect(formatComparison(c, true)).toContain('STILL WRONG (1)\n  1 (not_extracted)')
  })
})
