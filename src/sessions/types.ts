export type Role = 'missionary' | 'christian'

export type SessionStatus = 'waiting' | 'ready' | 'active' | 'completed' | 'expired' | 'ended'

/** Authoritative session state as seen by the current participant. */
export interface SessionSnapshot {
  id: string
  scenarioId: string
  scenarioVersion: number
  status: SessionStatus
  promptIndex: number
  revision: number
  round: number
  myRole: Role
  partnerJoined: boolean
  swapPending: boolean
  restartPending: boolean
  /** ISO time the restart was requested, or null when none is pending. */
  restartRequestedAt: string | null
  /** Chosen conditional response for the current prompt, or null. */
  selectedBranchId: string | null
  /** null when there is no partner yet; undefined when not yet known (Realtime rows). */
  partnerFresh: boolean | null | undefined
  expiresAt: string
  /** Only present for the missionary while waiting; never sent over Realtime. */
  pairCode: string | null | undefined
  codeExpiresAt: string | null | undefined
}

export type SessionErrorCode =
  | 'not_authenticated'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'invalid_state'
  | 'invalid_input'
  | 'invalid_code'
  | 'scenario_mismatch'
  | 'scenario_unavailable'
  | 'self_join'
  | 'session_expired'
  | 'rate_limited'
  | 'partner_stale'
  | 'out_of_range'
  | 'unavailable'
  | 'auth_failed'
  | 'captcha_required'

export type RpcResult = { ok: true; session: SessionSnapshot } | { ok: false; error: SessionErrorCode; session: SessionSnapshot | null }

export type NavigateDirection = 'back' | 'next'
