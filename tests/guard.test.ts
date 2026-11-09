import { describe, expect, it } from 'vitest'
import { isLocalSameOrigin } from '../src/mastra/guard'

describe('isLocalSameOrigin', () => {
  it('allows the page on our own address', () => {
    expect(isLocalSameOrigin('http://localhost:4111', 'localhost:4111')).toBe(true)
  })

  it('allows a request with no Origin, such as curl', () => {
    expect(isLocalSameOrigin(undefined, '127.0.0.1:4111')).toBe(true)
  })

  it('refuses another site', () => {
    expect(isLocalSameOrigin('https://evil.example', 'localhost:4111')).toBe(false)
  })

  it('refuses a rebinding host even when Origin matches it', () => {
    expect(isLocalSameOrigin('http://evil.example:4111', 'evil.example:4111')).toBe(false)
  })

  it('refuses a missing Host', () => {
    expect(isLocalSameOrigin('http://localhost:4111', undefined)).toBe(false)
  })

  it('refuses a malformed Origin', () => {
    expect(isLocalSameOrigin('not a url', 'localhost:4111')).toBe(false)
  })
})
