import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, Harness, rpc, type TestUser } from './harness'

let h: Harness
let users: TestUser[]

beforeAll(async () => {
  h = new Harness()
  users = await h.usersN(12)
})

afterAll(async () => {
  await h?.cleanup()
})

describe('pairing', () => {
  it('runs six pairs at once without any cross-talk', async () => {
    const missionaries = users.slice(0, 6)
    const christians = users.slice(6, 12)
    await h.resetRateLimits(...users)

    const sessions = await Promise.all(missionaries.map((m, i) => h.activePair(m, christians[i])))
    expect(new Set(sessions.map((s) => s.id)).size).toBe(6)

    // Pair i advances i % 3 prompts; others must be unaffected.
    await Promise.all(
      sessions.map(async (session, i) => {
        let revision = session.revision
        for (let step = 0; step < i % 3; step += 1) {
          const next = expectOk(
            await rpc(missionaries[i], 'navigate', {
              p_session_id: session.id,
              p_direction: 'next',
              p_expected_revision: revision,
            }),
          )
          revision = next.revision
        }
      }),
    )

    for (const [i, session] of sessions.entries()) {
      const forChristian = expectOk(await rpc(christians[i], 'get_session', { p_session_id: session.id }))
      expect(forChristian).toMatchObject({ status: 'active', prompt_index: i % 3, my_role: 'christian' })

      // Each participant can read only their own row through RLS.
      const { data, error } = await christians[i].client.from('sessions').select('id')
      expect(error).toBeNull()
      expect(data?.map((row) => row.id)).toEqual([session.id])

      // Nobody from another pair can see or drive this session.
      const other = missionaries[(i + 1) % 6]
      expectError(await rpc(other, 'get_session', { p_session_id: session.id }), 'not_found')
      expectError(
        await rpc(other, 'navigate', { p_session_id: session.id, p_direction: 'next', p_expected_revision: 0 }),
        'not_found',
      )
    }
  })

  it('rejects a third entrant and a self-join', async () => {
    const [missionary, christian, third] = users
    await h.resetRateLimits(missionary, christian, third)
    const created = expectOk(await h.createPair(missionary))
    const code = created.pair_code ?? ''

    expectError(await h.joinPair(missionary, code), 'self_join')
    expectOk(await h.joinPair(christian, code))
    expectError(await h.joinPair(third, code), 'invalid_code')
    expectError(await rpc(third, 'get_session', { p_session_id: created.id }), 'not_found')
  })

  it('lets exactly one of two simultaneous joiners take the seat', async () => {
    const [missionary, first, second] = users.slice(3, 6)
    await h.resetRateLimits(missionary, first, second)
    const created = expectOk(await h.createPair(missionary))
    const results = await Promise.all([first, second].map((u) => h.joinPair(u, created.pair_code ?? '')))

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.error === 'invalid_code')).toHaveLength(1)
    const state = expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id }))
    expect(state).toMatchObject({ status: 'ready', partner_joined: true, pair_code: null })
  })

  it('treats a retried create or join with the same request id as the same operation', async () => {
    const [missionary, christian] = users.slice(6, 8)
    await h.resetRateLimits(missionary, christian)
    const createId = randomUUID()
    const first = expectOk(await h.createPair(missionary, createId))
    const again = expectOk(await h.createPair(missionary, createId))
    expect(again.id).toBe(first.id)

    const joinId = randomUUID()
    const joined = expectOk(await h.joinPair(christian, first.pair_code ?? '', joinId))
    // The code is consumed, but the retry returns the seat already claimed.
    const retried = expectOk(await h.joinPair(christian, first.pair_code ?? '', joinId))
    expect(retried.id).toBe(joined.id)
    expect(retried.my_role).toBe('christian')

    const { rows } = await h.sql('select count(*)::int as n from public.sessions where missionary_user_id = $1', [
      missionary.id,
    ])
    expect(rows[0].n).toBeGreaterThanOrEqual(1)
    const { rows: forRequest } = await h.sql(
      "select count(*)::int as n from app_private.request_log where user_id = $1 and operation = 'create' and request_id = $2",
      [missionary.id, createId],
    )
    expect(forRequest[0].n).toBe(1)
  })

  it('rejects a code for another scenario version without consuming it', async () => {
    const [missionary, christian] = users.slice(8, 10)
    await h.resetRateLimits(missionary, christian)
    const created = expectOk(await h.createPair(missionary))
    expectError(await h.joinPair(christian, created.pair_code ?? '', randomUUID(), 999), 'scenario_mismatch')
    expectOk(await h.joinPair(christian, created.pair_code ?? ''))
  })

  it('normalizes typed codes the same way as the client', async () => {
    const [missionary, christian] = users.slice(10, 12)
    await h.resetRateLimits(missionary, christian)
    const created = expectOk(await h.createPair(missionary))
    const code = created.pair_code ?? ''
    const typed = ` ${code.slice(0, 3).toLowerCase()} - ${code.slice(3).toLowerCase()} `
    expectOk(await h.joinPair(christian, typed))
  })

  it('expires codes server-side and only allows regenerating an expired code', async () => {
    const [missionary, christian] = users.slice(0, 2)
    await h.resetRateLimits(missionary, christian)
    const created = expectOk(await h.createPair(missionary))
    expectError(await rpc(missionary, 'regenerate_pair_code', { p_session_id: created.id }), 'invalid_state')

    await h.sql("update app_private.pair_codes set expires_at = now() - interval '1 second' where session_id = $1", [
      created.id,
    ])
    expectError(await h.joinPair(christian, created.pair_code ?? ''), 'invalid_code')
    const waiting = expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id }))
    expect(waiting.pair_code).toBeNull()

    expectError(await rpc(christian, 'regenerate_pair_code', { p_session_id: created.id }), 'not_found')
    const regenerated = expectOk(await rpc(missionary, 'regenerate_pair_code', { p_session_id: created.id }))
    expect(regenerated.pair_code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
    expect(regenerated.pair_code).not.toBe(created.pair_code)
    expectOk(await h.joinPair(christian, regenerated.pair_code ?? ''))
  })

  it('counts every join attempt, including wrong guesses, toward the rate limit', async () => {
    const [missionary, guesser] = users.slice(2, 4)
    await h.resetRateLimits(missionary, guesser)
    const created = expectOk(await h.createPair(missionary))

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expectError(await h.joinPair(guesser, 'ZZZZZZ'), 'invalid_code')
    }
    // Even the correct code is refused once the window is used up.
    expectError(await h.joinPair(guesser, created.pair_code ?? ''), 'rate_limited')
    const { rows } = await h.sql(
      "select count(*)::int as n from app_private.rate_events where user_id = $1 and action = 'join'",
      [guesser.id],
    )
    expect(rows[0].n).toBe(10)
  })

  it('limits how many pairs one user can create', async () => {
    const [creator] = users.slice(4, 5)
    await h.resetRateLimits(creator)
    for (let i = 0; i < 5; i += 1) expectOk(await h.createPair(creator))
    expectError(await h.createPair(creator), 'rate_limited')
  })

  it('never issues a pairing code to the Christian', async () => {
    const [missionary, christian] = users.slice(5, 7)
    await h.resetRateLimits(missionary, christian)
    const ready = await h.readyPair(missionary, christian)
    const forChristian = expectOk(await rpc(christian, 'get_session', { p_session_id: ready.id }))
    expect(forChristian.pair_code).toBeNull()
    expect(forChristian.code_expires_at).toBeNull()
  })
})
