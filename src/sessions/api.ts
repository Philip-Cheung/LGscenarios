import type { SupabaseClient } from '@supabase/supabase-js'
import { parseRpcResult } from './schema'
import type { NavigateDirection, RpcResult } from './types'

/**
 * Thin adapter over the session RPCs. Identity always comes from the caller's
 * Supabase Auth session on the server; nothing here sends user ids or roles.
 */
export class SessionApi {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
    try {
      const { data, error } = await this.client.rpc(fn, args)
      if (error) {
        const authProblem = error.code === 'PGRST301' || error.code === '42501' || /jwt/i.test(error.message)
        return { ok: false, error: authProblem ? 'not_authenticated' : 'unavailable', session: null }
      }
      return parseRpcResult(data)
    } catch {
      return { ok: false, error: 'unavailable', session: null }
    }
  }

  createPair(scenarioId: string, version: number, requestId: string) {
    return this.call('create_pair', { p_scenario_id: scenarioId, p_version: version, p_request_id: requestId })
  }

  joinPair(code: string, scenarioId: string, version: number, requestId: string) {
    return this.call('join_pair', {
      p_code: code,
      p_scenario_id: scenarioId,
      p_version: version,
      p_request_id: requestId,
    })
  }

  regeneratePairCode(sessionId: string) {
    return this.call('regenerate_pair_code', { p_session_id: sessionId })
  }

  startPair(sessionId: string, expectedRevision: number) {
    return this.call('start_pair', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  navigate(sessionId: string, direction: NavigateDirection, expectedRevision: number) {
    return this.call('navigate', {
      p_session_id: sessionId,
      p_direction: direction,
      p_expected_revision: expectedRevision,
    })
  }

  finishPair(sessionId: string, expectedRevision: number) {
    return this.call('finish_pair', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  requestSwap(sessionId: string, expectedRevision: number) {
    return this.call('request_swap', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  respondSwap(sessionId: string, accept: boolean, expectedRevision: number) {
    return this.call('respond_swap', {
      p_session_id: sessionId,
      p_accept: accept,
      p_expected_revision: expectedRevision,
    })
  }

  heartbeat(sessionId: string) {
    return this.call('heartbeat', { p_session_id: sessionId })
  }

  getSession(sessionId: string) {
    return this.call('get_session', { p_session_id: sessionId })
  }
}
