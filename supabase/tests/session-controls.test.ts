import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, Harness, rpc, SAMPLE_BRANCH_ID, type TestUser } from './harness'

let h: Harness
let missionary: TestUser
let christian: TestUser
let outsider: TestUser

beforeAll(async () => {
  h = new Harness()
  ;[missionary, christian, outsider] = await h.usersN(3)
})

afterAll(async () => {
  await h?.cleanup()
})

const end = (user: TestUser, sessionId: string, revision: number) =>
  rpc(user, 'end_session', { p_session_id: sessionId, p_expected_revision: revision })

describe('ending a session', () => {
  it('lets either member end the pair, invalidates the code, and refuses to revive it', async () => {
    await h.resetRateLimits(missionary, christian)
    const waiting = expectOk(await h.createPair(missionary))
    const endedWaiting = expectOk(await end(missionary, waiting.id, waiting.revision))
    expect(endedWaiting.status).toBe('ended')
    expect(endedWaiting.pair_code).toBeNull()
    expectError(await h.joinPair(christian, waiting.pair_code ?? ''), 'invalid_code')
    expectError(
      await rpc(missionary, 'navigate', {
        p_session_id: waiting.id,
        p_direction: 'next',
        p_expected_revision: endedWaiting.revision,
      }),
      'invalid_state',
    )

    const active = await h.activePair(missionary, christian)
    expectError(await end(outsider, active.id, active.revision), 'not_found')
    const ended = expectOk(await end(christian, active.id, active.revision))
    expect(ended.status).toBe('ended')
    const again = expectError(await end(missionary, active.id, active.revision), 'conflict')
    expect(again?.status).toBe('ended')
    const reread = expectOk(await rpc(missionary, 'get_session', { p_session_id: active.id }))
    expect(reread).toMatchObject({ status: 'ended', revision: ended.revision })
    expectError(
      await rpc(missionary, 'request_restart', { p_session_id: active.id, p_expected_revision: reread.revision }),
      'invalid_state',
    )
  })

  it('lets the connected player end while the partner is disconnected', async () => {
    await h.resetRateLimits(missionary, christian)
    const state = await h.activePair(missionary, christian)
    await h.sql(
      "update app_private.heartbeats set last_seen_at = now() - interval '5 minutes' where session_id = $1 and user_id = $2",
      [state.id, christian.id],
    )
    const seen = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(seen.partner_fresh).toBe(false)
    expectError(
      await rpc(missionary, 'navigate', {
        p_session_id: state.id,
        p_direction: 'next',
        p_expected_revision: seen.revision,
      }),
      'partner_stale',
    )
    const ended = expectOk(await end(missionary, state.id, seen.revision))
    expect(ended.status).toBe('ended')
    const partner = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(partner.status).toBe('ended')
  })
})

describe('restart', () => {
  it('requires the missionary, and accept resets both phones once without changing roles', async () => {
    await h.resetRateLimits(missionary, christian)
    const state = await h.activePair(missionary, christian)
    const moved = expectOk(
      await rpc(missionary, 'navigate', {
        p_session_id: state.id,
        p_direction: 'next',
        p_expected_revision: state.revision,
      }),
    )
    expectError(
      await rpc(christian, 'request_restart', { p_session_id: state.id, p_expected_revision: moved.revision }),
      'forbidden',
    )
    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: moved.revision }),
    )
    expect(requested.restart_pending).toBe(true)
    expectError(
      await rpc(missionary, 'navigate', {
        p_session_id: state.id,
        p_direction: 'next',
        p_expected_revision: requested.revision,
      }),
      'invalid_state',
    )
    expectError(
      await rpc(missionary, 'respond_restart', {
        p_session_id: state.id,
        p_accept: true,
        p_expected_revision: requested.revision,
      }),
      'forbidden',
    )

    const accepted = expectOk(
      await rpc(christian, 'respond_restart', {
        p_session_id: state.id,
        p_accept: true,
        p_expected_revision: requested.revision,
      }),
    )
    expect(accepted).toMatchObject({
      my_role: 'christian',
      status: 'active',
      prompt_index: 0,
      round: state.round + 1,
      restart_pending: false,
      selected_branch_id: null,
    })
    const missionaryView = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(missionaryView).toMatchObject({ my_role: 'missionary', prompt_index: 0, round: accepted.round })
    expectError(
      await rpc(christian, 'respond_restart', {
        p_session_id: state.id,
        p_accept: true,
        p_expected_revision: requested.revision,
      }),
      'conflict',
    )
    const after = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(after.round).toBe(accepted.round)
  })

  it('keeps the prompt when the partner declines or the requester cancels', async () => {
    await h.resetRateLimits(missionary, christian)
    const state = await h.activePair(missionary, christian)
    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: state.revision }),
    )
    const declined = expectOk(
      await rpc(christian, 'respond_restart', {
        p_session_id: state.id,
        p_accept: false,
        p_expected_revision: requested.revision,
      }),
    )
    expect(declined).toMatchObject({
      prompt_index: 0,
      round: state.round,
      status: 'active',
      restart_pending: false,
      my_role: 'christian',
    })

    const again = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: declined.revision }),
    )
    expectError(
      await rpc(christian, 'cancel_restart', { p_session_id: state.id, p_expected_revision: again.revision }),
      'forbidden',
    )
    const cancelled = expectOk(
      await rpc(missionary, 'cancel_restart', { p_session_id: state.id, p_expected_revision: again.revision }),
    )
    expect(cancelled).toMatchObject({ prompt_index: 0, round: state.round, restart_pending: false })
  })

  it('clears an expired restart without resetting the prompt', async () => {
    await h.resetRateLimits(missionary, christian)
    const state = await h.activePair(missionary, christian)
    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: state.revision }),
    )
    await h.sql("update public.sessions set restart_requested_at = now() - interval '2 minutes' where id = $1", [
      state.id,
    ])
    const beat = expectOk(await rpc(christian, 'heartbeat', { p_session_id: state.id }))
    expect(beat.restart_pending).toBe(false)
    expect(beat.prompt_index).toBe(0)
    expect(beat.round).toBe(state.round)
    expect(beat.revision).toBeGreaterThan(requested.revision)
  })

  it('lets end win against restart acceptance, and blocks restart during a swap', async () => {
    await h.resetRateLimits(missionary, christian)
    const state = await h.activePair(missionary, christian)
    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: state.revision }),
    )
    const ended = expectOk(await end(missionary, state.id, requested.revision))
    expect(ended.status).toBe('ended')
    const lost = expectError(
      await rpc(christian, 'respond_restart', {
        p_session_id: state.id,
        p_accept: true,
        p_expected_revision: requested.revision,
      }),
      'conflict',
    )
    expect(lost?.status).toBe('ended')
    expect(lost?.round).toBe(state.round)

    const completed = await h.finishRound(missionary, await h.activePair(missionary, christian))
    const swap = expectOk(
      await rpc(missionary, 'request_swap', { p_session_id: completed.id, p_expected_revision: completed.revision }),
    )
    expectError(
      await rpc(missionary, 'request_restart', { p_session_id: completed.id, p_expected_revision: swap.revision }),
      'invalid_state',
    )
  })
})

describe('conditional branches', () => {
  it('shares one validated choice and rejects the other role, stale revisions, and unknown ids', async () => {
    await h.resetRateLimits(missionary, christian)
    let state = await h.activePair(missionary, christian)
    for (let i = 1; i < 3; i += 1) {
      state = expectOk(
        await rpc(missionary, 'navigate', {
          p_session_id: state.id,
          p_direction: 'next',
          p_expected_revision: state.revision,
        }),
      )
    }
    expect(state.prompt_index).toBe(2)
    expectError(
      await rpc(missionary, 'finish_pair', { p_session_id: state.id, p_expected_revision: state.revision }),
      'invalid_state',
    )
    expectError(
      await rpc(christian, 'select_branch', {
        p_session_id: state.id,
        p_branch_id: SAMPLE_BRANCH_ID,
        p_expected_revision: state.revision,
        p_expected_round: state.round,
      }),
      'forbidden',
    )
    expectError(
      await rpc(missionary, 'select_branch', {
        p_session_id: state.id,
        p_branch_id: 'not-a-choice',
        p_expected_revision: state.revision,
        p_expected_round: state.round,
      }),
      'invalid_input',
    )
    expectError(
      await rpc(outsider, 'select_branch', {
        p_session_id: state.id,
        p_branch_id: SAMPLE_BRANCH_ID,
        p_expected_revision: state.revision,
        p_expected_round: state.round,
      }),
      'not_found',
    )

    const selected = expectOk(
      await rpc(missionary, 'select_branch', {
        p_session_id: state.id,
        p_branch_id: SAMPLE_BRANCH_ID,
        p_expected_revision: state.revision,
        p_expected_round: state.round,
      }),
    )
    expect(selected).toMatchObject({ prompt_index: 2, round: state.round, selected_branch_id: SAMPLE_BRANCH_ID })
    const seen = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(seen.selected_branch_id).toBe(SAMPLE_BRANCH_ID)
    expectError(
      await rpc(missionary, 'select_branch', {
        p_session_id: state.id,
        p_branch_id: 'something-else',
        p_expected_revision: state.revision,
        p_expected_round: state.round,
      }),
      'conflict',
    )

    const restarted = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: selected.revision }),
    )
    const accepted = expectOk(
      await rpc(christian, 'respond_restart', {
        p_session_id: state.id,
        p_accept: true,
        p_expected_revision: restarted.revision,
      }),
    )
    expect(accepted).toMatchObject({ prompt_index: 0, selected_branch_id: null, round: state.round + 1 })
    expectError(
      await rpc(missionary, 'select_branch', {
        p_session_id: state.id,
        p_branch_id: SAMPLE_BRANCH_ID,
        p_expected_revision: accepted.revision,
        p_expected_round: state.round,
      }),
      'conflict',
    )
  })
})
