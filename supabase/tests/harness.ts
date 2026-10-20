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
export const SCENARIO_VERSION = 1
export const PROMPT_COUNT = 3

export interface TestUser {
  client: SupabaseClient
  id: string
}

export interface SessionState {
  id: string
  status: string
  prompt_index: number
  revision: number
  round: number
  my_role: 'missionary' | 'christian'
  partner_joined: boolean
  swap_pending: boolean
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

  async createPair(missionary: TestUser, requestId: string = randomUUID()): Promise<RpcResult> {
    return rpc(missionary, 'create_pair', {
      p_scenario_id: SCENARIO_ID,
      p_version: SCENARIO_VERSION,
      p_request_id: requestId,
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

  /** Creates and joins a pair; returns the ready session from the missionary's view. */
  async readyPair(missionary: TestUser, christian: TestUser): Promise<SessionState> {
    const created = expectOk(await this.createPair(missionary))
    const joined = expectOk(await this.joinPair(christian, created.pair_code ?? ''))
    expect(joined.status).toBe('ready')
    return expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id }))
  }

  /** Creates, joins, and starts a pair. */
  async activePair(missionary: TestUser, christian: TestUser): Promise<SessionState> {
    const ready = await this.readyPair(missionary, christian)
    return expectOk(
      await rpc(missionary, 'start_pair', { p_session_id: ready.id, p_expected_revision: ready.revision }),
    )
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
