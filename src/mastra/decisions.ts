import { reviewResume } from './schemas'

export const parseDecisions = (body: unknown) => {
  const parsed = reviewResume.safeParse(body)
  if (parsed.success) return { ok: true as const, data: parsed.data }
  return { ok: false as const, error: parsed.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }
}
