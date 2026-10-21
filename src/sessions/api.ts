import type { SupabaseClient } from '@supabase/supabase-js'
import { parseRpcResult } from './schema'
import type { EncounterAction, GuidedEvent, Role, RpcResult } from './types'

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

  /** The creator chooses their role; the partner who joins takes the other one. */
  createPair(scenarioId: string, version: number, requestId: string, role: Role) {
    return this.call('create_pair', {
      p_scenario_id: scenarioId,
      p_version: version,
      p_request_id: requestId,
      p_role: role,
    })
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

  /** Advances the shared conversation; the server checks role, stage, and content ids. */
  guidedEvent(sessionId: string, event: GuidedEvent, targetId: string | null, expectedRevision: number) {
    return this.call('guided_event', {
      p_session_id: sessionId,
      p_event: event,
      p_target_id: targetId,
      p_expected_revision: expectedRevision,
    })
  }

  /** Conversation scenarios: this player is ready; `relaxed` turns off the encounter timer for both. */
  setReady(sessionId: string, relaxed: boolean, expectedRevision: number) {
    return this.call('set_ready', { p_session_id: sessionId, p_relaxed: relaxed, p_expected_revision: expectedRevision })
  }

  /** Conversation scenarios: start, knock, open, or retry the doorstep encounter. */
  encounterAction(sessionId: string, action: EncounterAction, relaxed: boolean, expectedRevision: number) {
    return this.call('perform_encounter_action', {
      p_session_id: sessionId,
      p_action: action,
      p_relaxed: relaxed,
      p_expected_revision: expectedRevision,
    })
  }

  /**
   * Conversation scenarios: commits one spoken line by id. A retry with the
   * same command id returns the state the first attempt produced.
   */
  commitUtterance(sessionId: string, round: number, itemId: string, commandId: string, expectedRevision: number) {
    return this.call('commit_utterance', {
      p_session_id: sessionId,
      p_round: round,
      p_item_id: itemId,
      p_command_id: commandId,
      p_expected_revision: expectedRevision,
    })
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

  cancelSwap(sessionId: string, expectedRevision: number) {
    return this.call('cancel_swap', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  heartbeat(sessionId: string) {
    return this.call('heartbeat', { p_session_id: sessionId })
  }

  endSession(sessionId: string, expectedRevision: number) {
    return this.call('end_session', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  requestRestart(sessionId: string, expectedRevision: number) {
    return this.call('request_restart', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  requestHardMode(sessionId: string, expectedRevision: number) {
    return this.call('request_hard_mode', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  respondRestart(sessionId: string, accept: boolean, expectedRevision: number) {
    return this.call('respond_restart', {
      p_session_id: sessionId,
      p_accept: accept,
      p_expected_revision: expectedRevision,
    })
  }

  cancelRestart(sessionId: string, expectedRevision: number) {
    return this.call('cancel_restart', { p_session_id: sessionId, p_expected_revision: expectedRevision })
  }

  getSession(sessionId: string) {
    return this.call('get_session', { p_session_id: sessionId })
  }
}
