import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, Harness, PROMPT_COUNT, rpc, type TestUser } from './harness'

let h: Harness
let missionary: TestUser
let christian: TestUser

beforeAll(async () => {
  h = new Harness()
  ;[missionary, christian] = await h.usersN(2)
})

afterAll(async () => {
  await h?.cleanup()
})

async function freshActive() {
  await h.resetRateLimits(missionary, christian)
  return h.activePair(missionary, christian)
}

const nav = (sessionId: string, direction: string, revision: number) =>
  rpc(missionary, 'navigate', { p_session_id: sessionId, p_direction: direction, p_expected_revision: revision })

describe('session progress', () => {
  it('applies exactly one of two simultaneous Next commands', async () => {
    const state = await freshActive()
    const results = await Promise.all([nav(state.id, 'next', state.revision), nav(state.id, 'next', state.revision)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const rejected = results.find((r) => !r.ok)
    expect(rejected).toMatchObject({ ok: false, error: 'conflict' })
    // The rejection carries the authoritative state so the client can resync.
    expect(rejected && !rejected.ok ? rejected.session?.prompt_index : null).toBe(1)

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after.prompt_index).toBe(1)
    expect(after.revision).toBe(state.revision + 1)
  })

  it('rejects stale, malformed, and out-of-range commands without changing state', async () => {
    const state = await freshActive()
    expectError(await nav(state.id, 'next', state.revision - 1), 'conflict')
    expectError(await nav(state.id, 'sideways', state.revision), 'invalid_input')
    expectError(await nav(state.id, 'back', state.revision), 'out_of_range')

    let current = state
    for (let i = 1; i < PROMPT_COUNT; i += 1) current = expectOk(await nav(state.id, 'next', current.revision))
    expect(current.prompt_index).toBe(PROMPT_COUNT - 1)
    expectError(await nav(state.id, 'next', current.revision), 'out_of_range')

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ prompt_index: PROMPT_COUNT - 1, revision: current.revision })
  })

  it('only finishes from the last prompt', async () => {
    const state = await freshActive()
    expectError(
      await rpc(missionary, 'finish_pair', { p_session_id: state.id, p_expected_revision: state.revision }),
      'out_of_range',
    )
  })

  it('cannot start twice or navigate before starting', async () => {
    await h.resetRateLimits(missionary, christian)
    const ready = await h.readyPair(missionary, christian)
    expectError(await nav(ready.id, 'next', ready.revision), 'invalid_state')
    const started = expectOk(
      await rpc(missionary, 'start_pair', { p_session_id: ready.id, p_expected_revision: ready.revision }),
    )
    expectError(
      await rpc(missionary, 'start_pair', { p_session_id: ready.id, p_expected_revision: started.revision }),
      'invalid_state',
    )
  })

  it('pauses progress while the partner is away and resumes after their heartbeat', async () => {
    const state = await freshActive()
    await h.sql(
      "update app_private.heartbeats set last_seen_at = now() - interval '5 minutes' where session_id = $1 and user_id = $2",
      [state.id, christian.id],
    )
    const stale = expectError(await nav(state.id, 'next', state.revision), 'partner_stale')
    expect(stale?.partner_fresh).toBe(false)

    const beat = expectOk(await rpc(christian, 'heartbeat', { p_session_id: state.id }))
    // Heartbeats never change the session revision.
    expect(beat.revision).toBe(state.revision)
    expectOk(await nav(state.id, 'next', state.revision))
  })

  it('ends expired sessions everywhere and cleans them up', async () => {
    const state = await freshActive()
    await h.sql("update public.sessions set expires_at = now() - interval '1 second' where id = $1", [state.id])

    expectError(await rpc(missionary, 'get_session', { p_session_id: state.id }), 'session_expired')
    expectError(await rpc(christian, 'heartbeat', { p_session_id: state.id }), 'session_expired')
    expectError(await nav(state.id, 'next', state.revision), 'session_expired')
    const { data } = await christian.client.from('sessions').select('id').eq('id', state.id)
    expect(data).toEqual([])

    await h.sql('select app_private.cleanup_expired()')
    const marked = await h.sql('select status from public.sessions where id = $1', [state.id])
    expect(marked.rows[0].status).toBe('expired')

    await h.sql("update public.sessions set expires_at = now() - interval '2 hours' where id = $1", [state.id])
    await h.sql('select app_private.cleanup_expired()')
    const removed = await h.sql('select 1 from public.sessions where id = $1', [state.id])
    expect(removed.rowCount).toBe(0)
  })

  it('refuses unsafe anonymous-user cleanup windows', async () => {
    await expect(h.sql("select app_private.cleanup_anonymous_users(interval '1 hour')")).rejects.toThrow(/at least 13 hours/)
  })
})
