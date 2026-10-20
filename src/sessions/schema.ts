import * as z from 'zod/mini'
import type { RpcResult, SessionErrorCode, SessionSnapshot } from './types'

const uuid = z.uuid()
const status = z.enum(['waiting', 'ready', 'active', 'completed', 'expired'])
const scenarioId = z.string().check(z.maxLength(64))
const positiveInt = z.int().check(z.positive())
const nonnegativeInt = z.int().check(z.nonnegative())

const sessionStateSchema = z.object({
  id: uuid,
  scenario_id: scenarioId,
  scenario_version: positiveInt,
  status,
  prompt_index: nonnegativeInt,
  revision: nonnegativeInt,
  round: positiveInt,
  my_role: z.enum(['missionary', 'christian']),
  partner_joined: z.boolean(),
  swap_pending: z.boolean(),
  partner_fresh: z.nullable(z.boolean()),
  expires_at: z.string(),
  pair_code: z.nullable(z.string().check(z.regex(/^[A-Z0-9]{6}$/))),
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
    promptIndex: state.prompt_index,
    revision: state.revision,
    round: state.round,
    myRole: state.my_role,
    partnerJoined: state.partner_joined,
    swapPending: state.swap_pending,
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
  status,
  prompt_index: nonnegativeInt,
  // bigint columns can arrive as strings depending on the Realtime encoder.
  revision: z.pipe(z.coerce.number(), nonnegativeInt),
  round: positiveInt,
  swap_requested_by: z.nullable(uuid),
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
  return {
    id: value.id,
    scenarioId: value.scenario_id,
    scenarioVersion: value.scenario_version,
    status: value.status,
    promptIndex: value.prompt_index,
    revision: value.revision,
    round: value.round,
    myRole: isMissionary ? 'missionary' : 'christian',
    partnerJoined: value.christian_user_id !== null,
    swapPending: value.swap_requested_by !== null,
    partnerFresh: undefined,
    expiresAt: value.expires_at,
    pairCode: undefined,
    codeExpiresAt: undefined,
  }
}
