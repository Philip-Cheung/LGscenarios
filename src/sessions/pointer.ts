/**
 * Remembers which session this browser was in for a scenario slug, so a
 * refresh can resume. This is only a hint: membership is always verified by
 * the server before resuming. Never treat it as proof of anything.
 */
export interface SessionPointer {
  v: 1
  sessionId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function key(slug: string) {
  return `doorstep-practice:pointer:${slug}`
}

export function readPointer(slug: string): SessionPointer | null {
  try {
    const raw = window.localStorage.getItem(key(slug))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<SessionPointer>
    if (value.v !== 1 || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId)) return null
    return { v: 1, sessionId: value.sessionId }
  } catch {
    return null
  }
}

export function writePointer(slug: string, sessionId: string) {
  try {
    window.localStorage.setItem(key(slug), JSON.stringify({ v: 1, sessionId } satisfies SessionPointer))
  } catch {
    // Storage may be unavailable (private mode); resuming after refresh just won't work.
  }
}

export function clearPointer(slug: string) {
  try {
    window.localStorage.removeItem(key(slug))
  } catch {
    // Ignore unavailable storage.
  }
}
