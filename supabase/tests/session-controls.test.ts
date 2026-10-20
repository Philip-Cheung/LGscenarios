import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, FOLLOWUP_ID, guided, Harness, QUESTION_ID, rpc, type TestUser } from './harness'

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
    expectError(await guided(missionary, endedWaiting, 'ready'), 'invalid_state')

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
    expectError(await guided(missionary, seen, 'trigger_initiate'), 'partner_stale')
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
    const moved = expectOk(await guided(missionary, state, 'trigger_initiate'))
    expectError(
      await rpc(christian, 'request_restart', { p_session_id: state.id, p_expected_revision: moved.revision }),
      'forbidden',
    )
    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: state.id, p_expected_revision: moved.revision }),
    )
    expect(requested.restart_pending).toBe(true)
    expectError(await guided(christian, requested, 'trigger_acknowledge'), 'invalid_state')
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
      stage: 'scene_setup',
      my_ready: false,
      partner_ready: false,
      trigger_initiated: false,
      round: state.round + 1,
      restart_pending: false,
    })
    const missionaryView = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(missionaryView).toMatchObject({ my_role: 'missionary', stage: 'scene_setup', round: accepted.round })
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

    // Both players confirm the scene again before the new round starts.
    const again = await h.bothReady(missionary, christian, after)
    expect(again).toMatchObject({ status: 'active', stage: 'interaction_trigger', round: accepted.round })
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
      stage: 'interaction_trigger',
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
    expect(cancelled).toMatchObject({ stage: 'interaction_trigger', round: state.round, restart_pending: false })
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
    expect(beat.stage).toBe('interaction_trigger')
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

    const completed = await h.finishRound(missionary, christian, await h.activePair(missionary, christian))
    const swap = expectOk(
      await rpc(missionary, 'request_swap', { p_session_id: completed.id, p_expected_revision: completed.revision }),
    )
    expectError(
      await rpc(missionary, 'request_restart', { p_session_id: completed.id, p_expected_revision: swap.revision }),
      'invalid_state',
    )
  })
})

describe('restart during discussion', () => {
  it('clears the question, follow-up, and asked state on both phones and refuses the old round', async () => {
    await h.resetRateLimits(missionary, christian)
    const choosing = await h.walkToQuestions(missionary, christian, await h.activePair(missionary, christian))
    const discussing = expectOk(await guided(missionary, choosing, 'select_question', QUESTION_ID))
    const asked = expectOk(await guided(missionary, discussing, 'question_asked'))
    const followUp = expectOk(await guided(missionary, asked, 'select_followup', FOLLOWUP_ID))
    const followUpAsked = expectOk(await guided(missionary, followUp, 'question_asked'))
    expect(followUpAsked).toMatchObject({ active_question_id: QUESTION_ID, active_followup_id: FOLLOWUP_ID, question_asked: true })

    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: choosing.id, p_expected_revision: followUpAsked.revision }),
    )
    expectError(await guided(missionary, requested, 'return_to_questions'), 'invalid_state')
    const accepted = expectOk(
      await rpc(christian, 'respond_restart', {
        p_session_id: choosing.id,
        p_accept: true,
        p_expected_revision: requested.revision,
      }),
    )
    expect(accepted).toMatchObject({
      status: 'active',
      stage: 'scene_setup',
      active_question_id: null,
      active_followup_id: null,
      question_asked: false,
      trigger_initiated: false,
      round: choosing.round + 1,
    })
    const missionaryView = expectOk(await rpc(missionary, 'get_session', { p_session_id: choosing.id }))
    expect(missionaryView).toMatchObject({ stage: 'scene_setup', active_question_id: null, question_asked: false })

    // A command from the previous round is refused instead of resurrecting the old question.
    expectError(await guided(missionary, followUpAsked, 'select_question', QUESTION_ID), 'conflict')
    expectError(await guided(missionary, missionaryView, 'select_question', QUESTION_ID), 'invalid_state')
  })
})
