export type Role = 'missionary' | 'christian'

export type SessionStatus = 'waiting' | 'ready' | 'active' | 'completed' | 'expired' | 'ended'

/** Shared conversation stage. Question selection and discussion loop until the missionary finishes. */
export type GuidedStage =
  | 'scene_setup'
  | 'interaction_trigger'
  | 'opening_dialogue'
  | 'question_selection'
  | 'discussion'
  | 'conclusion'

/** Commands accepted by the `guided_event` RPC. */
export type GuidedEvent =
  | 'ready'
  | 'trigger_initiate'
  | 'trigger_acknowledge'
  | 'opening_complete'
  | 'select_question'
  | 'question_asked'
  | 'select_followup'
  | 'return_to_questions'
  | 'finish_discussion'

/** Authoritative session state as seen by the current participant. */
export interface SessionSnapshot {
  id: string
  scenarioId: string
  scenarioVersion: number
  status: SessionStatus
  revision: number
  round: number
  myRole: Role
  partnerJoined: boolean
  swapPending: boolean
  restartPending: boolean
  /** ISO time the restart was requested, or null when none is pending. */
  restartRequestedAt: string | null
  stage: GuidedStage
  /** Ready taps during scene setup. */
  meReady: boolean
  partnerReady: boolean
  triggerInitiated: boolean
  activeQuestionId: string | null
  activeFollowupId: string | null
  /** The missionary has asked the active question or follow-up aloud. */
  questionAsked: boolean
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
