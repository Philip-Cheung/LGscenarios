import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, guided, Harness, rpc, type SessionState, type TestUser } from './harness'

/** content/scenarios/week-one-first-vision.v1.json: schema 2.1 with an opening question and follow-ups. */
const WEEK_ONE = 'week-one-first-vision'
const WEEK_ONE_VERSION = 1

let h: Harness
let missionary: TestUser
let christian: TestUser

// Week 1 · We’re Christians too replaced this scenario for new pairs. Pairs
// already pinned to it keep working, so it opens here only for these tests.
const setOpenForNewPairs = (open: boolean) =>
  h.sql('update public.scenario_registry set active_for_new_sessions = $1 where scenario_id = $2 and version = $3', [
    open,
    WEEK_ONE,
    WEEK_ONE_VERSION,
  ])

beforeAll(async () => {
  h = new Harness()
  ;[missionary, christian] = await h.usersN(2)
  await setOpenForNewPairs(true)
})

afterAll(async () => {
  if (h) await setOpenForNewPairs(false)
  await h?.cleanup()
})

async function pair(creatorRole: 'missionary' | 'christian' = 'missionary') {
  await h.resetRateLimits(missionary, christian)
  const creator = creatorRole === 'missionary' ? missionary : christian
  const joiner = creatorRole === 'missionary' ? christian : missionary
  const created = expectOk(
    await rpc(creator, 'create_pair', {
      p_scenario_id: WEEK_ONE,
      p_version: WEEK_ONE_VERSION,
      p_request_id: randomUUID(),
      p_role: creatorRole,
    }),
  )
  expectOk(
    await rpc(joiner, 'join_pair', {
      p_code: created.pair_code,
      p_scenario_id: WEEK_ONE,
      p_version: WEEK_ONE_VERSION,
      p_request_id: randomUUID(),
    }),
  )
  return expectOk(await rpc(creator, 'get_session', { p_session_id: created.id }))
}

/** From a fresh pair, starts, readies, and begins: the missionary's view at the opening. */
async function atOpening(creatorRole: 'missionary' | 'christian' = 'missionary') {
  const paired = await pair(creatorRole)
  const creator = creatorRole === 'missionary' ? missionary : christian
  const scene = expectOk(await guided(creator, paired, 'start_practice'))
  const first = expectOk(await guided(missionary, scene, 'ready'))
  const both = expectOk(await guided(christian, first, 'ready'))
  return expectOk(await guided(missionary, both, 'begin'))
}

async function atTopics() {
  const opening = await atOpening()
  const asked = expectOk(await guided(missionary, opening, 'ask_opening_question'))
  return expectOk(await guided(christian, asked, 'share_complete'))
}

async function view(user: TestUser, state: SessionState) {
  return expectOk(await rpc(user, 'get_session', { p_session_id: state.id }))
}

describe('Week One opening question', () => {
  it('requires the church question and the Christian’s answer before the topics open', async () => {
    const opening = await atOpening()
    expect(opening).toMatchObject({ stage: 'opening_dialogue', opening_question_asked: false, exchange: 'initial' })

    expectError(await guided(missionary, opening, 'opening_complete'), 'invalid_state')
    expectError(await guided(missionary, opening, 'ask_question', 'faith'), 'invalid_state')
    expectError(await guided(christian, opening, 'share_complete'), 'invalid_state')
    expectError(await guided(christian, opening, 'ask_opening_question'), 'forbidden')

    const asked = expectOk(await guided(missionary, opening, 'ask_opening_question'))
    expect(asked).toMatchObject({ stage: 'opening_dialogue', opening_question_asked: true })
    expect(await view(christian, asked)).toMatchObject({ stage: 'opening_dialogue', opening_question_asked: true })
    expectError(await guided(missionary, asked, 'ask_opening_question'), 'invalid_state')
    expectError(await guided(missionary, asked, 'share_complete'), 'forbidden')
    expectError(await guided(missionary, asked, 'ask_question', 'faith'), 'invalid_state')

    const topics = expectOk(await guided(christian, asked, 'share_complete'))
    expect(topics).toMatchObject({ stage: 'question_selection', active_question_id: null, answered_question_ids: [] })
  })

  it('keeps creator ownership and turn permissions when the creator plays the Christian', async () => {
    await h.resetRateLimits(missionary, christian)
    const paired = await pair('christian')
    expect(paired).toMatchObject({ my_role: 'christian', is_creator: true, scenario_id: WEEK_ONE })
    expectError(await guided(missionary, await view(missionary, paired), 'start_practice'), 'forbidden')
    const scene = expectOk(await guided(christian, paired, 'start_practice'))
    const first = expectOk(await guided(christian, scene, 'ready'))
    const both = expectOk(await guided(missionary, first, 'ready'))
    expectError(await guided(christian, both, 'begin'), 'forbidden')
    const opening = expectOk(await guided(missionary, both, 'begin'))
    expectError(await guided(christian, opening, 'ask_opening_question'), 'forbidden')
    expectOk(await guided(missionary, opening, 'ask_opening_question'))
  })
})

describe('Week One topics and follow-ups', () => {
  it('runs initial question, follow-up, and answer before marking the topic answered', async () => {
    const topics = await atTopics()
    const asked = expectOk(await guided(missionary, topics, 'ask_question', 'faith'))
    expect(asked).toMatchObject({ stage: 'response', active_question_id: 'faith', exchange: 'initial' })

    const answered = expectOk(await guided(christian, asked, 'share_complete'))
    expect(answered).toMatchObject({
      stage: 'question_selection',
      active_question_id: 'faith',
      exchange: 'follow_up',
      answered_question_ids: [],
    })
    expectError(await guided(missionary, answered, 'ask_question', 'prayer'), 'invalid_state')
    expectError(await guided(christian, answered, 'share_complete'), 'invalid_state')
    expectError(await guided(christian, answered, 'ask_follow_up'), 'forbidden')
    expectError(await guided(christian, answered, 'next_topic'), 'forbidden')

    const followUp = expectOk(await guided(missionary, answered, 'ask_follow_up'))
    expect(followUp).toMatchObject({ stage: 'response', active_question_id: 'faith', exchange: 'follow_up' })
    expect(await view(christian, followUp)).toMatchObject({ stage: 'response', exchange: 'follow_up' })
    expectError(await guided(missionary, followUp, 'next_topic'), 'invalid_state')

    const done = expectOk(await guided(christian, followUp, 'share_complete'))
    expect(done).toMatchObject({
      stage: 'question_selection',
      active_question_id: null,
      exchange: 'initial',
      answered_question_ids: ['faith'],
    })
    // A duplicate tap with the old revision neither repeats the turn nor marks the topic twice.
    expectError(await guided(christian, followUp, 'share_complete'), 'conflict')
    expect((await view(missionary, done)).answered_question_ids).toEqual(['faith'])
    expectError(await guided(missionary, done, 'ask_follow_up'), 'invalid_state')
    expectError(await guided(missionary, done, 'next_topic'), 'invalid_state')
  })

  it('marks a skipped follow-up answered, and covers all four topics in any order', async () => {
    let state = await atTopics()
    const order = ['prayer', 'accounts', 'faith', 'first-vision']
    for (const [index, topic] of order.entries()) {
      state = expectOk(await guided(missionary, state, 'ask_question', topic))
      state = expectOk(await guided(christian, state, 'share_complete'))
      expect(state).toMatchObject({ active_question_id: topic, exchange: 'follow_up' })
      if (index % 2 === 0) {
        state = expectOk(await guided(missionary, state, 'next_topic'))
      } else {
        state = expectOk(await guided(missionary, state, 'ask_follow_up'))
        state = expectOk(await guided(christian, state, 'share_complete'))
      }
      expect(state).toMatchObject({ stage: 'question_selection', active_question_id: null, exchange: 'initial' })
      expect(state.answered_question_ids).toEqual(order.slice(0, index + 1))
    }
    const closing = expectOk(await guided(missionary, state, 'move_to_closing'))
    const done = expectOk(await guided(missionary, closing, 'finish'))
    expect(done).toMatchObject({ status: 'completed', stage: 'conclusion' })
  })

  it('moves to closing from a pending follow-up without marking that topic answered', async () => {
    const topics = await atTopics()
    const asked = expectOk(await guided(missionary, topics, 'ask_question', 'accounts'))
    const pending = expectOk(await guided(christian, asked, 'share_complete'))
    const closing = expectOk(await guided(missionary, pending, 'move_to_closing'))
    expect(closing).toMatchObject({ stage: 'closing', active_question_id: null, exchange: 'initial', answered_question_ids: [] })
    expect(await view(christian, closing)).toMatchObject({ stage: 'closing', exchange: 'initial' })
  })

  it('resets the opening and topic state on an accepted restart and on a role switch', async () => {
    const topics = await atTopics()
    const asked = expectOk(await guided(missionary, topics, 'ask_question', 'faith'))
    const pending = expectOk(await guided(christian, asked, 'share_complete'))
    expect(pending).toMatchObject({ opening_question_asked: true, exchange: 'follow_up' })

    const requested = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: pending.id, p_expected_revision: pending.revision }),
    )
    const declined = expectOk(
      await rpc(christian, 'respond_restart', {
        p_session_id: pending.id,
        p_accept: false,
        p_expected_revision: requested.revision,
      }),
    )
    expect(declined).toMatchObject({ stage: 'question_selection', active_question_id: 'faith', exchange: 'follow_up' })

    const again = expectOk(
      await rpc(missionary, 'request_restart', { p_session_id: pending.id, p_expected_revision: declined.revision }),
    )
    const restarted = expectOk(
      await rpc(christian, 'respond_restart', { p_session_id: pending.id, p_accept: true, p_expected_revision: again.revision }),
    )
    expect(restarted).toMatchObject({
      stage: 'scene_setup',
      opening_question_asked: false,
      exchange: 'initial',
      active_question_id: null,
      answered_question_ids: [],
    })

    // Finish a round, then switch roles: the new round starts clean as well.
    let state = expectOk(await guided(missionary, restarted, 'ready'))
    state = expectOk(await guided(christian, state, 'ready'))
    state = expectOk(await guided(missionary, state, 'begin'))
    state = expectOk(await guided(missionary, state, 'ask_opening_question'))
    state = expectOk(await guided(christian, state, 'share_complete'))
    state = expectOk(await guided(missionary, state, 'move_to_closing'))
    state = expectOk(await guided(missionary, state, 'finish'))
    const swap = expectOk(await rpc(missionary, 'request_swap', { p_session_id: state.id, p_expected_revision: state.revision }))
    const swapped = expectOk(
      await rpc(christian, 'respond_swap', { p_session_id: state.id, p_accept: true, p_expected_revision: swap.revision }),
    )
    expect(swapped).toMatchObject({ my_role: 'missionary', opening_question_asked: false, exchange: 'initial', answered_question_ids: [] })
  })
})
