import type { SessionSnapshot } from './types'

export const RESTART_TIMEOUT_MS = 60_000

/** True when a restart request is still inside the server's 60 second window. */
export function isRestartCurrent(requestedAt: string | null, now = Date.now()): boolean {
  if (!requestedAt) return false
  const at = Date.parse(requestedAt)
  if (Number.isNaN(at)) return false
  return now - at < RESTART_TIMEOUT_MS
}

/**
 * Decides whether an incoming snapshot replaces the current one.
 *
 * - Older revisions are ignored, so a slow fetch cannot overwrite a newer event.
 * - A newer revision replaces semantic state.
 * - The same revision only refreshes volatile fields (partner freshness, pairing
 *   code), which change without a revision bump.
 * - Fields an incoming snapshot does not carry (undefined) keep prior values.
 */
export function mergeSnapshot(current: SessionSnapshot | null, incoming: SessionSnapshot): SessionSnapshot {
  if (!current || current.id !== incoming.id) return withDefaults(incoming)
  if (incoming.revision < current.revision) return current

  const merged: SessionSnapshot = withDefaults({
    ...(incoming.revision > current.revision ? incoming : current),
    partnerFresh: incoming.partnerFresh !== undefined ? incoming.partnerFresh : current.partnerFresh,
    pairCode: incoming.pairCode !== undefined ? incoming.pairCode : current.pairCode,
    codeExpiresAt: incoming.codeExpiresAt !== undefined ? incoming.codeExpiresAt : current.codeExpiresAt,
  })
  if (merged.status !== 'waiting') {
    merged.pairCode = null
    merged.codeExpiresAt = null
  }
  return isSame(current, merged) ? current : merged
}

function withDefaults(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    restartPending: snapshot.restartPending ?? false,
    restartRequestedAt: snapshot.restartRequestedAt ?? null,
    partnerFresh: snapshot.partnerFresh,
    pairCode: snapshot.pairCode ?? null,
    codeExpiresAt: snapshot.codeExpiresAt ?? null,
  }
}

function isSame(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return (Object.keys(a) as (keyof SessionSnapshot)[]).every((key) => a[key] === b[key])
}

/** True when the partner is known to be away and progress should pause. */
export function isPartnerAway(snapshot: SessionSnapshot): boolean {
  return snapshot.partnerJoined && snapshot.partnerFresh === false
}
