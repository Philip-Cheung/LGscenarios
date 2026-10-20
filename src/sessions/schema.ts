import * as z from 'zod/mini'
import { isRestartCurrent } from './snapshot'
import type { RpcResult, SessionErrorCode, SessionSnapshot } from './types'

const uuid = z.uuid()
const role = z.enum(['missionary', 'christian'])
const status = z.enum(['waiting', 'ready', 'active', 'completed', 'expired', 'ended'])
const stage = z.enum([
  'paired',
  'scene_setup',
  'ready_together',
  'opening_dialogue',
  'question_selection',
  'response',
  'closing',
  'conclusion',
])
const contentId = z.string().check(z.maxLength(40), z.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/))
const scenarioId = z.string().check(z.maxLength(64))
const positiveInt = z.int().check(z.positive())
const nonnegativeInt = z.int().check(z.nonnegative())
const answeredIds = z.array(contentId).check(z.maxLength(12))
const exchange = z.enum(['initial', 'follow_up'])

const sessionStateSchema = z.object({
  id: uuid,
  scenario_id: scenarioId,
  scenario_version: positiveInt,
  status,
  revision: nonnegativeInt,
  round: positiveInt,
  my_role: role,
  is_creator: z.boolean(),
  partner_joined: z.boolean(),
  swap_pending: z.boolean(),
  restart_pending: z.optional(z.boolean()),
  restart_by_me: z.optional(z.boolean()),
  restart_requested_at: z.optional(z.nullable(z.string())),
  stage,
  my_ready: z.boolean(),
  partner_ready: z.boolean(),
  active_question_id: z.nullable(contentId),
  answered_question_ids: answeredIds,
  opening_question_asked: z.boolean(),
  exchange,
  partner_fresh: z.nullable(z.boolean()),
  expires_at: z.string(),
  pair_code: z.nullable(z.string().check(z.regex(/^[0-9]{6}$/))),
  code_expires_at: z.nullable(z.string()),
})

const knownErrors = [
  'not_authenticated',
  'not_found',
  'forbidden',
  'conflict',
  'invalid_state',
  'invalid_input',
  'invalid_code',
  'scenario_mismatch',
  'scenario_unavailable',
  'self_join',
  'session_expired',
  'rate_limited',
  'partner_stale',
  'out_of_range',
] as const satisfies readonly SessionErrorCode[]

const rpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), session: sessionStateSchema }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    session: z.optional(z.nullable(sessionStateSchema)),
  }),
])

function toSnapshot(state: z.infer<typeof sessionStateSchema>): SessionSnapshot {
  return {
    id: state.id,
    scenarioId: state.scenario_id,
    scenarioVersion: state.scenario_version,
    status: state.status,
    revision: state.revision,
    round: state.round,
    myRole: state.my_role,
    isCreator: state.is_creator,
    partnerJoined: state.partner_joined,
    swapPending: state.swap_pending,
    restartPending: state.restart_pending ?? false,
    restartByMe: state.restart_by_me ?? false,
    restartRequestedAt: state.restart_requested_at ?? null,
    stage: state.stage,
    meReady: state.my_ready,
    partnerReady: state.partner_ready,
    activeQuestionId: state.active_question_id,
    answeredQuestionIds: state.answered_question_ids,
    openingQuestionAsked: state.opening_question_asked,
    exchange: state.exchange,
    partnerFresh: state.partner_fresh,
    expiresAt: state.expires_at,
    pairCode: state.pair_code,
    codeExpiresAt: state.code_expires_at,
  }
}

/** Parses an RPC response; anything unexpected becomes `unavailable`. */
export function parseRpcResult(data: unknown): RpcResult {
  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) return { ok: false, error: 'unavailable', session: null }
  if (parsed.data.ok) return { ok: true, session: toSnapshot(parsed.data.session) }
  const error = (knownErrors as readonly string[]).includes(parsed.data.error)
    ? (parsed.data.error as SessionErrorCode)
    : 'unavailable'
  return { ok: false, error, session: parsed.data.session ? toSnapshot(parsed.data.session) : null }
}

const realtimeRowSchema = z.object({
  id: uuid,
  scenario_id: scenarioId,
  scenario_version: positiveInt,
  missionary_user_id: uuid,
  christian_user_id: z.nullable(uuid),
  creator_user_id: uuid,
  creator_role: role,
  status,
  // bigint columns can arrive as strings depending on the Realtime encoder.
  revision: z.pipe(z.coerce.number(), nonnegativeInt),
  round: positiveInt,
  swap_requested_by: z.nullable(uuid),
  restart_requested_by: z.optional(z.nullable(uuid)),
  restart_requested_at: z.optional(z.nullable(z.string())),
  stage,
  missionary_ready: z.boolean(),
  christian_ready: z.boolean(),
  active_question_id: z.nullable(contentId),
  answered_question_ids: answeredIds,
  opening_question_asked: z.boolean(),
  exchange,
  expires_at: z.string(),
})

/** Columns requested from Realtime; the payload never includes pairing codes. */
export const REALTIME_SESSION_COLUMNS = Object.keys(realtimeRowSchema.shape)

/**
 * Converts a Realtime UPDATE row into a snapshot for `viewerId`. Fields that
 * Realtime does not carry are left undefined so the merge keeps prior values.
 */
export function snapshotFromRealtimeRow(row: unknown, viewerId: string): SessionSnapshot | null {
  const parsed = realtimeRowSchema.safeParse(row)
  if (!parsed.success) return null
  const value = parsed.data
  const isMissionary = value.missionary_user_id === viewerId
  if (!isMissionary && value.christian_user_id !== viewerId) return null
  // While waiting, the creator holds the missionary seat whichever role they chose.
  const myRole = value.status === 'waiting' ? value.creator_role : isMissionary ? 'missionary' : 'christian'
  return {
    id: value.id,
    scenarioId: value.scenario_id,
    scenarioVersion: value.scenario_version,
    status: value.status,
    revision: value.revision,
    round: value.round,
    myRole,
    isCreator: value.creator_user_id === viewerId,
    partnerJoined: value.christian_user_id !== null,
    swapPending: value.swap_requested_by !== null,
    restartPending: value.restart_requested_by != null && isRestartCurrent(value.restart_requested_at ?? null),
    restartByMe: value.restart_requested_by != null && value.restart_requested_by === viewerId,
    restartRequestedAt: value.restart_requested_at ?? null,
    stage: value.stage,
    meReady: isMissionary ? value.missionary_ready : value.christian_ready,
    partnerReady: isMissionary ? value.christian_ready : value.missionary_ready,
    activeQuestionId: value.active_question_id,
    answeredQuestionIds: value.answered_question_ids,
    openingQuestionAsked: value.opening_question_asked,
    exchange: value.exchange,
    partnerFresh: undefined,
    expiresAt: value.expires_at,
    pairCode: undefined,
    codeExpiresAt: undefined,
  }
}
