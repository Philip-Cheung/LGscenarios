export type Role = 'missionary' | 'christian'

export type SessionStatus = 'waiting' | 'ready' | 'active' | 'completed' | 'expired' | 'ended'

/**
 * Shared practice stage. `paired` comes before the six steps; question
 * selection and response loop until the missionary moves to closing.
 */
export type GuidedStage =
  | 'paired'
  | 'scene_setup'
  | 'ready_together'
  | 'opening_dialogue'
  | 'question_selection'
  | 'response'
  | 'closing'
  | 'conclusion'

/** Commands accepted by the `guided_event` RPC. */
export type GuidedEvent =
  | 'start_practice'
  | 'ready'
  | 'begin'
  | 'opening_complete'
  | 'ask_opening_question'
  | 'ask_question'
  | 'share_complete'
  | 'ask_follow_up'
  | 'next_topic'
  | 'move_to_closing'
  | 'finish'

/** Whether the active topic is on its first question or its follow-up. */
export type Exchange = 'initial' | 'follow_up'

/** Authoritative session state as seen by the current participant. */
export interface SessionSnapshot {
  id: string
  scenarioId: string
  scenarioVersion: number
  status: SessionStatus
  revision: number
  round: number
  myRole: Role
  /** True for the person who created the practice; they start it from the paired summary. */
  isCreator: boolean
  partnerJoined: boolean
  swapPending: boolean
  restartPending: boolean
  /** True when this participant asked for the pending restart. */
  restartByMe: boolean
  /** ISO time the restart was requested, or null when none is pending. */
  restartRequestedAt: string | null
  stage: GuidedStage
  /** Ready taps during scene setup. */
  meReady: boolean
  partnerReady: boolean
  /**
   * The topic in progress: set during a response, and while a follow-up waits
   * to be asked or skipped back at the topic list.
   */
  activeQuestionId: string | null
  /** Topics finished on this round (follow-up answered or skipped), in order. */
  answeredQuestionIds: readonly string[]
  /** The missionary has asked the scenario's opening question. */
  openingQuestionAsked: boolean
  exchange: Exchange
  /** null when there is no partner yet; undefined when not yet known (Realtime rows). */
  partnerFresh: boolean | null | undefined
  expiresAt: string
  /** Only present for the creator while waiting; never sent over Realtime. */
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
