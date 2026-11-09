import { describe, expect, it } from 'vitest'
import { reviewPage } from '../src/mastra/page'

describe('reviewPage', () => {
  it('is a full HTML page with the review title', () => {
    expect(reviewPage.startsWith('<!doctype html>')).toBe(true)
    expect(reviewPage).toContain('<title>claim-check review</title>')
  })

  it('never inserts text as HTML, because drafts and claims are untrusted', () => {
    expect(reviewPage).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  })

  it('has a script that parses', () => {
    const script = reviewPage.split('<script>')[1].split('</script>')[0]
    expect(() => new Function(script)).not.toThrow()
  })
})
