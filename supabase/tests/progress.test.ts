import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectError,
  expectOk,
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

describe('pairing summary and scene readiness', () => {
  it('starts at the paired summary, which only the missionary can leave', async () => {
    await h.resetRateLimits(missionary, christian)
    const paired = await h.readyPair(missionary, christian)
    expect(paired).toMatchObject({ status: 'ready', stage: 'paired', my_ready: false, partner_ready: false })
    expectError(await guided(christian, paired, 'start_practice'), 'forbidden')
    expectError(await guided(missionary, paired, 'ready'), 'invalid_state')
    const scene = expectOk(await guided(missionary, paired, 'start_practice'))
    expect(scene).toMatchObject({ status: 'ready', stage: 'scene_setup' })
    expectError(await guided(missionary, scene, 'start_practice'), 'invalid_state')
  })

  it('waits for both players, treats a repeated Ready as harmless, then gets ready together', async () => {
    await h.resetRateLimits(missionary, christian)
    const scene = await h.scenePair(missionary, christian)

    const mine = expectOk(await guided(missionary, scene, 'ready'))
    expect(mine).toMatchObject({ status: 'ready', stage: 'scene_setup', my_ready: true, partner_ready: false })
    // A double tap or a retry with an old revision changes nothing.
    const repeated = expectOk(await guided(missionary, scene, 'ready'))
    expect(repeated.revision).toBe(mine.revision)

    const partnerView = expectOk(await rpc(christian, 'get_session', { p_session_id: scene.id }))
    expect(partnerView).toMatchObject({ my_ready: false, partner_ready: true, stage: 'scene_setup' })

    const both = expectOk(await guided(christian, partnerView, 'ready'))
    expect(both).toMatchObject({ status: 'active', stage: 'ready_together', my_ready: true, partner_ready: true })
    expectError(await guided(missionary, both, 'ready'), 'invalid_state')
  })
})

describe('guided transitions', () => {
  it('applies exactly one of two simultaneous question choices', async () => {
    const state = await freshChoosing()
    const results = await Promise.all([
      guided(missionary, state, 'ask_question', QUESTION_ID),
      guided(missionary, state, 'ask_question', OTHER_QUESTION_ID),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const rejected = results.find((r) => !r.ok)
    expect(rejected).toMatchObject({ ok: false, error: 'conflict' })
    // The rejection carries the authoritative state so the client can resync.
    const winner = results.find((r) => r.ok)
    const winningId = winner && winner.ok ? winner.session.active_question_id : null
    expect(rejected && !rejected.ok ? rejected.session?.active_question_id : null).toBe(winningId)

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ stage: 'response', active_question_id: winningId, revision: state.revision + 1 })
  })

  it('lets the missionary lead and only the Christian finish sharing', async () => {
    const state = await freshActive()
    expectError(await guided(christian, state, 'begin'), 'forbidden')
    const opening = expectOk(await guided(missionary, state, 'begin'))
    expect(opening.stage).toBe('opening_dialogue')
    expectError(await guided(christian, opening, 'opening_complete'), 'forbidden')
    const choosing = expectOk(await guided(missionary, opening, 'opening_complete'))
    expect(choosing.stage).toBe('question_selection')

    expectError(await guided(christian, choosing, 'ask_question', QUESTION_ID), 'forbidden')
    expectError(await guided(christian, choosing, 'move_to_closing'), 'forbidden')
    const asked = expectOk(await guided(missionary, choosing, 'ask_question', QUESTION_ID))
    expectError(await guided(missionary, asked, 'share_complete'), 'forbidden')
    const shared = expectOk(await guided(christian, asked, 'share_complete'))
    const closing = expectOk(await guided(missionary, shared, 'move_to_closing'))
    expectError(await guided(christian, closing, 'finish'), 'forbidden')
  })

  it('refuses steps out of order without changing state', async () => {
    const state = await freshActive()
    expectError(await guided(missionary, state, 'opening_complete'), 'invalid_state')
    expectError(await guided(missionary, state, 'ask_question', QUESTION_ID), 'invalid_state')
    expectError(await guided(missionary, state, 'move_to_closing'), 'invalid_state')
    expectError(await guided(missionary, state, 'finish'), 'invalid_state')

    const choosing = await h.walkToQuestions(missionary, christian, state)
    expectError(await guided(christian, choosing, 'share_complete'), 'invalid_state')
    expectError(await guided(missionary, choosing, 'finish'), 'invalid_state')
    const asked = expectOk(await guided(missionary, choosing, 'ask_question', QUESTION_ID))
    expectError(await guided(missionary, asked, 'ask_question', OTHER_QUESTION_ID), 'invalid_state')
    expectError(await guided(missionary, asked, 'move_to_closing'), 'invalid_state')

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ revision: asked.revision, stage: 'response', active_question_id: QUESTION_ID })
  })

  it('rejects stale revisions, unknown and retired events, and ids that are not in the pinned content', async () => {
    const state = await freshChoosing()
    expectError(await guided(missionary, { id: state.id, revision: state.revision - 1 }, 'ask_question', QUESTION_ID), 'conflict')
    expectError(await guided(missionary, state, 'jump_to_end'), 'invalid_input')
    for (const retired of ['trigger_initiate', 'select_question', 'question_asked', 'finish_discussion']) {
      expectError(await guided(missionary, state, retired), 'invalid_input')
    }
    expectError(await guided(missionary, state, 'ask_question'), 'invalid_input')
    expectError(await guided(missionary, state, 'move_to_closing', QUESTION_ID), 'invalid_input')
    expectError(await guided(missionary, state, 'ask_question', 'Not An Id'), 'invalid_input')
    expectError(await guided(missionary, state, 'ask_question', 'not-a-question'), 'invalid_input')

    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after).toMatchObject({ stage: 'question_selection', active_question_id: null, revision: state.revision })
  })

  it('loops through questions, then closes and finishes', async () => {
    const choosing = await freshChoosing()
    const asked = expectOk(await guided(missionary, choosing, 'ask_question', QUESTION_ID))
    expect(asked).toMatchObject({ stage: 'response', active_question_id: QUESTION_ID })
    const seen = expectOk(await rpc(christian, 'get_session', { p_session_id: choosing.id }))
    expect(seen).toMatchObject({ stage: 'response', active_question_id: QUESTION_ID })

    const back = expectOk(await guided(christian, asked, 'share_complete'))
    expect(back).toMatchObject({ stage: 'question_selection', active_question_id: null })

    const next = expectOk(await guided(missionary, back, 'ask_question', OTHER_QUESTION_ID))
    const again = expectOk(await guided(christian, next, 'share_complete'))
    const closing = expectOk(await guided(missionary, again, 'move_to_closing'))
    expect(closing).toMatchObject({ status: 'active', stage: 'closing' })
    const done = expectOk(await guided(missionary, closing, 'finish'))
    expect(done).toMatchObject({ status: 'completed', stage: 'conclusion', active_question_id: null })
    expectError(await guided(missionary, done, 'ask_question', QUESTION_ID), 'invalid_state')
  })

  it('pauses progress while the partner is away and resumes after their heartbeat', async () => {
    const state = await freshActive()
    await h.sql(
      "update app_private.heartbeats set last_seen_at = now() - interval '5 minutes' where session_id = $1 and user_id = $2",
      [state.id, christian.id],
    )
    const stale = expectError(await guided(missionary, state, 'begin'), 'partner_stale')
    expect(stale?.partner_fresh).toBe(false)

    const beat = expectOk(await rpc(christian, 'heartbeat', { p_session_id: state.id }))
    // Heartbeats never change the session revision.
    expect(beat.revision).toBe(state.revision)
    expectOk(await guided(missionary, state, 'begin'))
  })

  it('ends expired sessions everywhere and cleans them up', async () => {
    const state = await freshActive()
    await h.sql("update public.sessions set expires_at = now() - interval '1 second' where id = $1", [state.id])

    expectError(await rpc(missionary, 'get_session', { p_session_id: state.id }), 'session_expired')
    expectError(await rpc(christian, 'heartbeat', { p_session_id: state.id }), 'session_expired')
    expectError(await guided(missionary, state, 'begin'), 'session_expired')
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
