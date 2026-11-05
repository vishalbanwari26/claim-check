import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkRepoLanguage, readConfirmedFacts, readJobAd } from '../src/mastra/tools'

afterEach(() => vi.unstubAllGlobals())

const github = (status: number, body: unknown = {}) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('checkRepoLanguage', () => {
  it('returns the main language', async () => {
    github(200, { language: 'Ruby' })
    expect(await checkRepoLanguage.execute!({ repo: 'octocat/linguist' }, {})).toMatchObject({ status: 'ok', mainLanguage: 'Ruby' })
  })
  it('reports a repo with no language as null', async () => {
    github(200, { language: null })
    expect(await checkRepoLanguage.execute!({ repo: 'a/b' }, {})).toMatchObject({ status: 'ok', mainLanguage: null })
  })
  it.each([[404, 'not_found'], [403, 'rate_limited'], [429, 'rate_limited'], [500, 'error']])('turns HTTP %i into %s', async (code, status) => {
    github(code)
    expect(await checkRepoLanguage.execute!({ repo: 'a/b' }, {})).toMatchObject({ status, mainLanguage: null })
  })
  it('turns a network failure into data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await checkRepoLanguage.execute!({ repo: 'a/b' }, {})).toMatchObject({ status: 'error' })
  })
  it('rejects a bad repo string before any request goes out', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await checkRepoLanguage.execute!({ repo: '../../etc/passwd' }, {})).toMatchObject({ error: true })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('file tools', () => {
  it('rejects path traversal in ids', async () => {
    expect(await readConfirmedFacts.execute!({ candidateId: '../secrets' }, {})).toMatchObject({ error: true })
    expect(await readJobAd.execute!({ jobId: '../../.env' }, {})).toMatchObject({ error: true })
  })
  it('reads the invented candidate and job ad', async () => {
    const facts = await readConfirmedFacts.execute!({ candidateId: 'ines-varga' }, {})
    expect(facts).toMatchObject({ projects: expect.arrayContaining([{ name: 'linguist', repo: 'octocat/linguist' }]) })
    expect(await readJobAd.execute!({ jobId: 'quillbeam-ai-engineer' }, {})).toMatchObject({ text: expect.stringContaining('Quillbeam') })
  })
})
