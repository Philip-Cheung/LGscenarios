import { randomUUID } from 'node:crypto'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectError,
  expectOk,
  guided,
  Harness,
  QUESTION_ID,
  rpc,
  SCENARIO_VERSION,
  TransportError,
  type SessionState,
  type TestUser,
} from './harness'

let h: Harness
let missionary: TestUser
let christian: TestUser
let outsider: TestUser
let session: SessionState

beforeAll(async () => {
  h = new Harness()
  ;[missionary, christian, outsider] = await h.usersN(3)
  session = await h.activePair(missionary, christian)
})

afterAll(async () => {
  await h?.cleanup()
})

/** Resolves with the received row ids once SUBSCRIBED; collects UPDATE events. */
async function watch(client: SupabaseClient, sessionId: string) {
  const events: Record<string, unknown>[] = []
  let channel: RealtimeChannel | null = null
  const status = await new Promise<string>((resolve) => {
    channel = client
      .channel(`auth-test-${randomUUID()}`, { config: { postgres_changes_options: { wait: true } } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, (payload) =>
        events.push(payload.new),
      )
      .subscribe((state) => {
        if (state !== 'SUBSCRIBED' && state !== 'CHANNEL_ERROR' && state !== 'TIMED_OUT') return
        resolve(state)
      })
  })
  return { events, status, channel: channel as RealtimeChannel | null }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('signed-out callers', () => {
  it('cannot call RPCs or read sessions, but can read published scenarios and never drafts', async () => {
    const anon = h.anonymousClient()
    await expect(rpc(anon, 'get_session', { p_session_id: session.id })).rejects.toBeInstanceOf(TransportError)
    await expect(
      rpc(anon, 'guided_event', {
        p_session_id: session.id,
        p_event: 'ready',
        p_target_id: null,
        p_expected_revision: session.revision,
      }),
    ).rejects.toBeInstanceOf(TransportError)

    const sessions = await anon.from('sessions').select('id')
    expect(sessions.error).not.toBeNull()

    const registry = await anon.from('scenario_registry').select('scenario_id, version, status, active_for_new_sessions')
    expect(registry.error).toBeNull()
    expect(registry.data).toContainEqual({
      scenario_id: 'sample-doorstep',
      version: SCENARIO_VERSION,
      status: 'published',
      active_for_new_sessions: true,
    })
    expect(registry.data?.every((row) => row.status === 'published')).toBe(true)

    const { rows: drafts } = await h.sql<{ scenario_id: string; version: number }>(
      "select scenario_id, version from public.scenario_registry where status = 'draft'",
    )
    for (const draft of drafts) {
      expect(registry.data).not.toContainEqual(expect.objectContaining({ scenario_id: draft.scenario_id, version: draft.version }))
    }
    const signedIn = await missionary.client.from('scenario_registry').select('status')
    expect(signedIn.data?.every((row) => row.status === 'published')).toBe(true)
  })

  it('finds the featured scenario for the site root', async () => {
    const anon = h.anonymousClient()
    const { data, error } = await anon.rpc('featured_scenario')
    expect(error).toBeNull()
    const { rows } = await h.sql<{ slug: string }>(
      "select slug from public.scenario_registry where status = 'published' and active_for_new_sessions order by published_at desc limit 1",
    )
    expect(data).toBe(rows[0].slug)
  })
})

describe('unrelated signed-in users', () => {
  it('cannot read, list, or drive another pair', async () => {
    expectError(await rpc(outsider, 'get_session', { p_session_id: session.id }), 'not_found')
    expectError(await rpc(outsider, 'heartbeat', { p_session_id: session.id }), 'not_found')
    for (const [fn, args] of [
      ['guided_event', { p_event: 'begin', p_target_id: null, p_expected_revision: session.revision }],
      ['request_swap', { p_expected_revision: session.revision }],
      ['respond_swap', { p_accept: true, p_expected_revision: session.revision }],
      ['regenerate_pair_code', {}],
    ] as const) {
      expectError(await rpc(outsider, fn, { p_session_id: session.id, ...args }), 'not_found')
    }
    const { data, error } = await outsider.client.from('sessions').select('id').eq('id', session.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('receive no Realtime events for another pair, while participants do', async () => {
    const participant = await watch(christian.client, session.id)
    const intruder = await watch(outsider.client, session.id)
    const signedOut = await watch(h.anonymousClient(), session.id)
    expect(participant.status).toBe('SUBSCRIBED')

    const current = expectOk(await rpc(missionary, 'get_session', { p_session_id: session.id }))
    const moved = expectOk(await guided(missionary, current, 'begin'))

    for (let i = 0; i < 50 && participant.events.length === 0; i += 1) await wait(200)
    expect(participant.events.length).toBeGreaterThan(0)
    expect(participant.events.at(-1)).toMatchObject({
      id: session.id,
      stage: moved.stage,
      revision: moved.revision,
    })
    expect(participant.events.at(-1)).not.toHaveProperty('pair_code')

    await wait(2000)
    expect(intruder.events).toEqual([])
    expect(signedOut.events).toEqual([])
  })
})

describe('direct table access', () => {
  it('rejects direct writes to sessions even by participants', async () => {
    const before = await h.sql('select stage, revision from public.sessions where id = $1', [session.id])
    const update = await missionary.client
      .from('sessions')
      .update({ stage: 'conclusion', active_question_id: null })
      .eq('id', session.id)
      .select()
    expect(update.error).not.toBeNull()

    const insert = await missionary.client.from('sessions').insert({
      scenario_id: 'sample-doorstep',
      scenario_version: 1,
      missionary_user_id: missionary.id,
    })
    expect(insert.error).not.toBeNull()

    const remove = await missionary.client.from('sessions').delete().eq('id', session.id).select()
    expect(remove.error).not.toBeNull()

    const registry = await missionary.client.from('scenario_registry').update({ active_for_new_sessions: false }).eq('scenario_id', 'sample-doorstep').select()
    expect(registry.error).not.toBeNull()

    const draft = await missionary.client.from('scenario_registry').update({ status: 'published' }).eq('status', 'draft').select()
    expect(draft.error).not.toBeNull()

    const { rows } = await h.sql('select stage, revision from public.sessions where id = $1', [session.id])
    expect(rows[0]).toEqual(before.rows[0])
  })

  it('does not expose private tables or helper functions', async () => {
    const codes = await missionary.client.schema('app_private').from('pair_codes').select('*')
    expect(codes.error).not.toBeNull()
    await expect(rpc(missionary, 'cleanup_expired', {})).rejects.toBeInstanceOf(TransportError)
    await expect(rpc(missionary, 'session_state', {})).rejects.toBeInstanceOf(TransportError)
  })

  it('no longer exposes the retired linear prompt commands', async () => {
    for (const [fn, args] of [
      ['start_pair', { p_expected_revision: session.revision }],
      ['navigate', { p_direction: 'next', p_expected_revision: session.revision }],
      ['finish_pair', { p_expected_revision: session.revision }],
      ['select_branch', { p_branch_id: 'they-agree', p_expected_revision: session.revision, p_expected_round: 1 }],
    ] as const) {
      await expect(rpc(missionary, fn, { p_session_id: session.id, ...args })).rejects.toBeInstanceOf(TransportError)
    }
  })
})

describe('role permissions', () => {
  it('only lets the current missionary lead, choose questions, finish, and request a swap', async () => {
    const current = expectOk(await rpc(christian, 'get_session', { p_session_id: session.id }))
    for (const [event, target] of [
      ['start_practice', null],
      ['begin', null],
      ['opening_complete', null],
      ['ask_question', QUESTION_ID],
      ['move_to_closing', null],
      ['finish', null],
    ] as const) {
      expectError(await guided(christian, current, event, target), 'forbidden')
    }
    expectError(
      await rpc(christian, 'request_swap', { p_session_id: session.id, p_expected_revision: current.revision }),
      'forbidden',
    )
  })

  it('moves control to the other phone after a role swap', async () => {
    const [m, c] = await h.usersN(2)
    let state = await h.finishRound(m, c, await h.activePair(m, c))
    expect(state.status).toBe('completed')

    // Only the Christian can answer a swap request, and only the missionary can make one.
    expectError(
      await rpc(m, 'respond_swap', { p_session_id: state.id, p_accept: true, p_expected_revision: state.revision }),
      'forbidden',
    )
    state = expectOk(await rpc(m, 'request_swap', { p_session_id: state.id, p_expected_revision: state.revision }))
    expect(state.swap_pending).toBe(true)
    const swapped = expectOk(
      await rpc(c, 'respond_swap', { p_session_id: state.id, p_accept: true, p_expected_revision: state.revision }),
    )
    expect(swapped).toMatchObject({
      my_role: 'missionary',
      status: 'ready',
      stage: 'paired',
      my_ready: false,
      partner_ready: false,
      active_question_id: null,
      round: 2,
    })

    // Both phones return to the paired summary; the creator still starts the practice.
    const forOld = expectOk(await rpc(m, 'get_session', { p_session_id: state.id }))
    expect(forOld).toMatchObject({ my_role: 'christian', is_creator: true, stage: 'paired' })
    expect(swapped.is_creator).toBe(false)
    expectError(await guided(c, swapped, 'start_practice'), 'forbidden')
    const scene = expectOk(await guided(m, forOld, 'start_practice'))
    const together = await h.bothReady(c, m, scene)
    expectError(await guided(m, together, 'begin'), 'forbidden')
    expectOk(await guided(c, together, 'begin'))
  })

  it('keeps roles when a swap is declined', async () => {
    const [m, c] = await h.usersN(2)
    let state = await h.finishRound(m, c, await h.activePair(m, c))
    state = expectOk(await rpc(m, 'request_swap', { p_session_id: state.id, p_expected_revision: state.revision }))
    const declined = expectOk(
      await rpc(c, 'respond_swap', { p_session_id: state.id, p_accept: false, p_expected_revision: state.revision }),
    )
    expect(declined).toMatchObject({ my_role: 'christian', status: 'completed', swap_pending: false, round: 1 })
  })
})
