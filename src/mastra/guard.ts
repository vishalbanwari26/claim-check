// Keeps the review API to requests made from this machine, by a page served from this server.
// Without it, any web page open in the reviewer's browser could post decisions to localhost.

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

export const isLocalSameOrigin = (origin: string | null | undefined, host: string | null | undefined): boolean => {
  if (!host) return false
  try {
    if (!LOCAL.has(new URL(`http://${host}`).hostname)) return false
    return !origin || new URL(origin).host === host
  } catch {
    return false
  }
}
