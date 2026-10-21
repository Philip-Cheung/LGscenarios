/**
 * Shared harness for real-database tests against a disposable Supabase
 * project. Browser-equivalent clients use only the publishable key and
 * anonymous sign-in. The direct database connection is used solely to move
 * clocks (expire codes, sessions, heartbeats), reset rate counters, and clean
 * up afterwards. Secrets are never logged.
 */
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { expect } from 'vitest'
import { assertDisposableTarget } from './target'

export const SCENARIO_ID = 'sample-doorstep'
export const SCENARIO_VERSION = 6
/** Ids from content/scenarios/sample-doorstep.v6.json. */
export const QUESTION_ID = 'hope'
export const OTHER_QUESTION_ID = 'faith'

export interface TestUser {
  client: SupabaseClient
  id: string
}

export interface SessionState {
  id: string
  scenario_id: string
  scenario_version: number
  status: string
  stage: string
  revision: number
  round: number
  my_role: 'missionary' | 'christian'
  is_creator: boolean
  partner_joined: boolean
  swap_pending: boolean
  swap_by_me: boolean
  swap_requested_at: string | null
  restart_pending?: boolean
  restart_by_me?: boolean
  my_ready: boolean
  partner_ready: boolean
  active_question_id: string | null
  answered_question_ids: string[]
  opening_question_asked: boolean
  exchange: 'initial' | 'follow_up'
  turn: 'missionary' | 'christian'
  history: { speaker: 'missionary' | 'christian'; id: string }[]
  encounter_phase: 'knock' | 'open' | null
  encounter_deadline: string | null
  encounter_relaxed: boolean
  server_now: string
  partner_fresh: boolean | null
  pair_code: string | null
  code_expires_at: string | null
}

export type RpcResult = { ok: true; session: SessionState } | { ok: false; error: string; session: SessionState | null }

export class Harness {
  readonly db: pg.Pool
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly users: TestUser[] = []
  private readonly clients: SupabaseClient[] = []

  constructor() {
    const target = assertDisposableTarget()
    this.apiUrl = target.apiUrl
    this.publishableKey = target.publishableKey
    this.db = new pg.Pool({ connectionString: target.databaseUrl, max: 4 })
  }

  /** A client that has not signed in (Postgres role `anon`). */
  anonymousClient(): SupabaseClient {
    const client = createClient(this.apiUrl, this.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    this.clients.push(client)
    return client
  }

  /** A browser-equivalent client signed in as a fresh anonymous user. */
  async user(): Promise<TestUser> {
    const client = this.anonymousClient()
    const captchaToken = process.env.TEST_CAPTCHA_TOKEN || undefined
    const { data, error } = await client.auth.signInAnonymously({ options: { captchaToken } })
    if (error || !data.user) {
      throw new Error(
        `Anonymous sign-in failed (${error?.code ?? error?.status ?? 'no user'}). ` +
          'Check that anonymous sign-ins are enabled and the anonymous sign-in rate limit is raised on the test project.',
      )
    }
    const user = { client, id: data.user.id }
    this.users.push(user)
    return user
  }

  async usersN(count: number): Promise<TestUser[]> {
    return Promise.all(Array.from({ length: count }, () => this.user()))
  }

  async sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
    return this.db.query<T>(text, values)
  }

  /** Clears abuse counters so tests can create many pairs per user. */
  async resetRateLimits(...users: TestUser[]) {
    await this.sql('delete from app_private.rate_events where user_id = any($1::uuid[])', [users.map((u) => u.id)])
  }

  async createPair(
    creator: TestUser,
    requestId: string = randomUUID(),
    role: 'missionary' | 'christian' = 'missionary',
  ): Promise<RpcResult> {
    return rpc(creator, 'create_pair', {
      p_scenario_id: SCENARIO_ID,
      p_version: SCENARIO_VERSION,
      p_request_id: requestId,
      p_role: role,
    })
  }

  async joinPair(christian: TestUser, code: string, requestId: string = randomUUID(), version = SCENARIO_VERSION) {
    return rpc(christian, 'join_pair', {
      p_code: code,
      p_scenario_id: SCENARIO_ID,
      p_version: version,
      p_request_id: requestId,
    })
  }

  /** Creates and joins a pair; returns the missionary's view of the paired summary. */
  async readyPair(missionary: TestUser, christian: TestUser): Promise<SessionState> {
    const created = expectOk(await this.createPair(missionary))
    const joined = expectOk(await this.joinPair(christian, created.pair_code ?? ''))
    expect(joined).toMatchObject({ status: 'ready', stage: 'paired' })
    return expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id }))
  }

  /** Creates and joins a pair, then the missionary taps Start practice; leaves it at the scene. */
  async scenePair(missionary: TestUser, christian: TestUser): Promise<SessionState> {
    const paired = await this.readyPair(missionary, christian)
    return expectOk(await guided(missionary, paired, 'start_practice'))
  }

  /** Both players tap Ready on the scene; returns the missionary's view at Ready together. */
  async bothReady(missionary: TestUser, christian: TestUser, state: SessionState): Promise<SessionState> {
    const first = expectOk(await guided(missionary, state, 'ready'))
    expectOk(await guided(christian, first, 'ready'))
    return expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
  }

  /** Creates, joins, starts, and readies a pair, leaving it at Ready together. */
  async activePair(missionary: TestUser, christian: TestUser): Promise<SessionState> {
    const scene = await this.scenePair(missionary, christian)
    return this.bothReady(missionary, christian, scene)
  }

  /** From Ready together, begins and finishes the opening line. */
  async walkToQuestions(missionary: TestUser, _christian: TestUser, state: SessionState): Promise<SessionState> {
    const opening = expectOk(await guided(missionary, state, 'begin'))
    return expectOk(await guided(missionary, opening, 'opening_complete'))
  }

  /** Walks a pair at Ready together through one question to the conclusion. */
  async finishRound(missionary: TestUser, christian: TestUser, state: SessionState): Promise<SessionState> {
    const choosing = await this.walkToQuestions(missionary, christian, state)
    const asked = expectOk(await guided(missionary, choosing, 'ask_question', QUESTION_ID))
    const shared = expectOk(await guided(christian, asked, 'share_complete'))
    const closing = expectOk(await guided(missionary, shared, 'move_to_closing'))
    return expectOk(await guided(missionary, closing, 'finish'))
  }

  async cleanup() {
    await Promise.all(this.clients.map((client) => client.removeAllChannels()))
    const ids = this.users.map((u) => u.id)
    if (ids.length > 0) {
      await this.sql('delete from app_private.rate_events where user_id = any($1::uuid[])', [ids])
      await this.sql('delete from auth.users where id = any($1::uuid[]) and is_anonymous', [ids])
    }
    await this.db.end()
  }
}

/** Calls an RPC as a user. API-layer failures (e.g. permission denied) throw `TransportError`. */
export async function rpc(user: TestUser | SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const client = 'client' in user ? user.client : user
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new TransportError(fn, error.code, error.message)
  return data as RpcResult
}

/** Sends one guided-flow event at the state's revision. */
export function guided(
  user: TestUser,
  state: Pick<SessionState, 'id' | 'revision'>,
  event: string,
  targetId: string | null = null,
): Promise<RpcResult> {
  return rpc(user, 'guided_event', {
    p_session_id: state.id,
    p_event: event,
    p_target_id: targetId,
    p_expected_revision: state.revision,
  })
}

export class TransportError extends Error {
  readonly fn: string
  readonly code: string | undefined

  constructor(fn: string, code: string | undefined, message: string) {
    super(`${fn} failed at the API layer (${code ?? 'no code'}): ${message}`)
    this.fn = fn
    this.code = code
  }
}

export function expectOk(result: RpcResult): SessionState {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error}`)
  return result.session
}

export function expectError(result: RpcResult, error: string): SessionState | null {
  expect(result).toMatchObject({ ok: false, error })
  return result.ok ? null : result.session
}
