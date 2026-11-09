import { describe, expect, it } from 'vitest'
import { localOnly, statusFor } from '../src/mastra/routes'

const ctx = (headers: Record<string, string>) => ({
  req: { header: (n: string) => headers[n.toLowerCase()] },
  json: (body: unknown, status: number) => ({ body, status }),
}) as never

describe('localOnly', () => {
  it('answers 403 and does not continue for a cross-site request', async () => {
    let called = false
    const res = await localOnly(ctx({ origin: 'https://evil.example', host: 'localhost:4111' }), async () => { called = true })
    expect(res).toEqual({ body: { error: 'Not allowed from this origin' }, status: 403 })
    expect(called).toBe(false)
  })

  it('continues to the route for a local same-origin request', async () => {
    let called = false
    await localOnly(ctx({ host: 'localhost:4111' }), async () => { called = true })
    expect(called).toBe(true)
  })
})

describe('statusFor', () => {
  it('maps the errors review.ts throws to HTTP statuses', () => {
    expect(statusFor('No run r1')).toBe(404)
    expect(statusFor('Run r1 is success, not suspended')).toBe(409)
    expect(statusFor('anything else')).toBe(500)
  })
})
