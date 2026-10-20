import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectError,
  expectOk,
  FOLLOWUP_ID,
  guided,
  Harness,
  OTHER_QUESTION_ID,
  QUESTION_ID,
  rpc,
  type TestUser,
} from './harness'

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

async function freshChoosing() {
  return h.walkToQuestions(missionary, christian, await freshActive())
}

describe('scene readiness', () => {
  it('waits for both players, treats a repeated Ready as harmless, then starts the interaction', async () => {
    await h.resetRateLimits(missionary, christian)
    const ready = await h.readyPair(missionary, christian)
    expect(ready).toMatchObject({ status: 'ready', stage: 'scene_setup', my_ready: false, partner_ready: false })

    const mine = expectOk(await guided(missionary, ready, 'ready'))
    expect(mine).toMatchObject({ status: 'ready', stage: 'scene_setup', my_ready: true, partner_ready: false })
    // A double tap or a retry with an old revision changes nothing.
    const repeated = expectOk(await guided(missionary, ready, 'ready'))
    expect(repeated.revision).toBe(mine.revision)

    const partnerView = expectOk(await rpc(christian, 'get_session', { p_session_id: ready.id }))
    expect(partnerView).toMatchObject({ my_ready: false, partner_ready: true, stage: 'scene_setup' })

    const both = expectOk(await guided(christian, partnerView, 'ready'))
    expect(both).toMatchObject({ status: 'active', stage: 'interaction_trigger', my_ready: true, partner_ready: true })
    expectError(await guided(missionary, both, 'ready'), 'invalid_state')
  })
})

describe('guided transitions', () => {
  it('applies exactly one of two simultaneous question choices', async () => {
    const state = await freshChoosing()
    const results = await Promise.all([
      guided(missionary, state, 'select_question', QUESTION_ID),
      guided(missionary, state, 'select_question', OTHER_QUESTION_ID),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const rejected = results.find((r) => !r.ok)
    expect(rejected).toMatchObject({ ok: false, error: 'conflict' })
    // The rejection carries the authoritative state so the client can resync.
    const winner = results.find((r) => r.ok)
    const winningId = winner && winner.ok ? winner.session.active_question_id : null
    expect(rejected && !rejected.ok ? rejected.session?.active_question_id : null).toBe(winningId)

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ stage: 'discussion', active_question_id: winningId, revision: state.revision + 1 })
  })

  it('lets only the roles named by the scenario drive each step', async () => {
    const state = await freshActive()
    expectError(await guided(christian, state, 'trigger_initiate'), 'forbidden')
    const knocked = expectOk(await guided(missionary, state, 'trigger_initiate'))
    expectError(await guided(missionary, knocked, 'trigger_acknowledge'), 'forbidden')
    const opened = expectOk(await guided(christian, knocked, 'trigger_acknowledge'))
    expect(opened.stage).toBe('opening_dialogue')
    expectError(await guided(christian, opened, 'opening_complete'), 'forbidden')
    const choosing = expectOk(await guided(missionary, opened, 'opening_complete'))
    expect(choosing.stage).toBe('question_selection')

    expectError(await guided(christian, choosing, 'select_question', QUESTION_ID), 'forbidden')
    expectError(await guided(christian, choosing, 'finish_discussion'), 'forbidden')
    const discussing = expectOk(await guided(missionary, choosing, 'select_question', QUESTION_ID))
    for (const event of ['question_asked', 'return_to_questions', 'finish_discussion']) {
      expectError(await guided(christian, discussing, event), 'forbidden')
    }
    const asked = expectOk(await guided(missionary, discussing, 'question_asked'))
    expectError(await guided(christian, asked, 'select_followup', FOLLOWUP_ID), 'forbidden')
  })

  it('refuses steps out of order without changing state', async () => {
    const state = await freshActive()
    expectError(await guided(missionary, state, 'opening_complete'), 'invalid_state')
    expectError(await guided(christian, state, 'trigger_acknowledge'), 'invalid_state')
    expectError(await guided(missionary, state, 'select_question', QUESTION_ID), 'invalid_state')
    expectError(await guided(missionary, state, 'finish_discussion'), 'invalid_state')

    const choosing = await h.walkToQuestions(missionary, christian, state)
    expectError(await guided(missionary, choosing, 'question_asked'), 'invalid_state')
    expectError(await guided(missionary, choosing, 'return_to_questions'), 'invalid_state')
    const discussing = expectOk(await guided(missionary, choosing, 'select_question', QUESTION_ID))
    expectError(await guided(missionary, discussing, 'select_followup', FOLLOWUP_ID), 'invalid_state')
    const asked = expectOk(await guided(missionary, discussing, 'question_asked'))
    expectError(await guided(missionary, asked, 'question_asked'), 'invalid_state')

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ revision: asked.revision, question_asked: true })
  })

  it('rejects stale revisions, unknown events, and ids that are not in the pinned content', async () => {
    const state = await freshChoosing()
    expectError(await guided(missionary, { id: state.id, revision: state.revision - 1 }, 'select_question', QUESTION_ID), 'conflict')
    expectError(await guided(missionary, state, 'jump_to_end'), 'invalid_input')
    expectError(await guided(missionary, state, 'select_question'), 'invalid_input')
    expectError(await guided(missionary, state, 'finish_discussion', QUESTION_ID), 'invalid_input')
    expectError(await guided(missionary, state, 'select_question', 'Not An Id'), 'invalid_input')
    expectError(await guided(missionary, state, 'select_question', 'not-a-question'), 'invalid_input')

    // A follow-up id must belong to the active question.
    const other = expectOk(await guided(missionary, state, 'select_question', OTHER_QUESTION_ID))
    const asked = expectOk(await guided(missionary, other, 'question_asked'))
    expectError(await guided(missionary, asked, 'select_followup', FOLLOWUP_ID), 'invalid_input')

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ active_question_id: OTHER_QUESTION_ID, active_followup_id: null, revision: asked.revision })
  })

  it('loops through questions and follow-ups, then finishes', async () => {
    const choosing = await freshChoosing()
    const discussing = expectOk(await guided(missionary, choosing, 'select_question', QUESTION_ID))
    expect(discussing).toMatchObject({ stage: 'discussion', active_question_id: QUESTION_ID, question_asked: false })

    const asked = expectOk(await guided(missionary, discussing, 'question_asked'))
    const seen = expectOk(await rpc(christian, 'get_session', { p_session_id: choosing.id }))
    expect(seen).toMatchObject({ active_question_id: QUESTION_ID, question_asked: true })

    const followUp = expectOk(await guided(missionary, asked, 'select_followup', FOLLOWUP_ID))
    expect(followUp).toMatchObject({ active_question_id: QUESTION_ID, active_followup_id: FOLLOWUP_ID, question_asked: false })
    const followUpAsked = expectOk(await guided(missionary, followUp, 'question_asked'))

    const back = expectOk(await guided(missionary, followUpAsked, 'return_to_questions'))
    expect(back).toMatchObject({
      stage: 'question_selection',
      active_question_id: null,
      active_followup_id: null,
      question_asked: false,
    })

    const next = expectOk(await guided(missionary, back, 'select_question', OTHER_QUESTION_ID))
    const done = expectOk(await guided(missionary, next, 'finish_discussion'))
    expect(done).toMatchObject({ status: 'completed', stage: 'conclusion', active_question_id: null })
    expectError(await guided(missionary, done, 'select_question', QUESTION_ID), 'invalid_state')
  })

  it('pauses progress while the partner is away and resumes after their heartbeat', async () => {
    const state = await freshActive()
    await h.sql(
      "update app_private.heartbeats set last_seen_at = now() - interval '5 minutes' where session_id = $1 and user_id = $2",
      [state.id, christian.id],
    )
    const stale = expectError(await guided(missionary, state, 'trigger_initiate'), 'partner_stale')
    expect(stale?.partner_fresh).toBe(false)

    const beat = expectOk(await rpc(christian, 'heartbeat', { p_session_id: state.id }))
    // Heartbeats never change the session revision.
    expect(beat.revision).toBe(state.revision)
    expectOk(await guided(missionary, state, 'trigger_initiate'))
  })

  it('ends expired sessions everywhere and cleans them up', async () => {
    const state = await freshActive()
    await h.sql("update public.sessions set expires_at = now() - interval '1 second' where id = $1", [state.id])

    expectError(await rpc(missionary, 'get_session', { p_session_id: state.id }), 'session_expired')
    expectError(await rpc(christian, 'heartbeat', { p_session_id: state.id }), 'session_expired')
    expectError(await guided(missionary, state, 'trigger_initiate'), 'session_expired')
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
