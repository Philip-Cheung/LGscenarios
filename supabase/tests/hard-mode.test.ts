import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, Harness, rpc, type SessionState, type TestUser } from './harness'

/**
 * Hard mode: from Lesson 1's reflection screen, one participant asks and the
 * other accepts; the pair moves to the newest published version of the
 * scenario the lesson names, with the same roles. Runs against temporary
 * copies of content/scenarios/lesson-one-first-vision.v3.json and
 * week-one-hard-mode.v1.json under their own ids and an old publication date,
 * so neither is ever the featured scenario. They are deleted afterwards.
 */
const SUFFIX = randomUUID().slice(0, 8)
const LESSON = `test-lesson-hard-${SUFFIX}`
const HARD = `test-hard-${SUFFIX}`
const ORPHAN = `test-orphan-${SUFFIX}`

function load(path: string, id: string, hardMode?: string) {
  const file = JSON.parse(readFileSync(path, 'utf8'))
  const { $schema: _schema, status: _status, hardMode: _link, ...content } = file
  return { ...content, id, version: 1, ...(hardMode ? { hardMode: { scenarioId: hardMode } } : {}) }
}

let h: Harness
let users: TestUser[]

beforeAll(async () => {
  h = new Harness()
  const insert = (id: string, content: unknown) =>
    h.sql(
      `insert into public.scenario_registry
         (scenario_id, version, slug, prompt_count, status, content, active_for_new_sessions, published_at)
       values ($1, 1, $1, 5, 'published', $2, true, '2000-01-01')`,
      [id, content],
    )
  await insert(HARD, load('content/scenarios/week-one-hard-mode.v1.json', HARD))
  await insert(LESSON, load('content/scenarios/lesson-one-first-vision.v3.json', LESSON, HARD))
  await insert(ORPHAN, load('content/scenarios/lesson-one-first-vision.v3.json', ORPHAN, `test-missing-${SUFFIX}`))
  users = await h.usersN(6)
})

afterAll(async () => {
  if (h) {
    await h.sql('delete from public.sessions where scenario_id = any($1)', [[LESSON, HARD, ORPHAN]])
    await h.sql('delete from public.scenario_registry where scenario_id = any($1)', [[LESSON, HARD, ORPHAN]])
    await h.cleanup()
  }
})

type Revisioned = Pick<SessionState, 'id' | 'revision' | 'round'>

const commit = (user: TestUser, state: Revisioned, itemId: string) =>
  rpc(user, 'commit_utterance', {
    p_session_id: state.id,
    p_round: state.round,
    p_item_id: itemId,
    p_command_id: randomUUID(),
    p_expected_revision: state.revision,
  })

const requestHardMode = (user: TestUser, state: Revisioned) =>
  rpc(user, 'request_hard_mode', { p_session_id: state.id, p_expected_revision: state.revision })

const respond = (user: TestUser, state: Revisioned, accept: boolean) =>
  rpc(user, 'respond_restart', { p_session_id: state.id, p_accept: accept, p_expected_revision: state.revision })

/** Both ready, then knock and open: the pair is at the door of the current scenario. */
async function toTheDoor(missionary: TestUser, christian: TestUser, from: SessionState): Promise<SessionState> {
  let state = expectOk(await rpc(missionary, 'set_ready', { p_session_id: from.id, p_relaxed: true, p_expected_revision: from.revision }))
  state = expectOk(await rpc(christian, 'set_ready', { p_session_id: state.id, p_relaxed: true, p_expected_revision: state.revision }))
  for (const [user, action] of [
    [missionary, 'start'],
    [missionary, 'knock'],
    [christian, 'open'],
  ] as const) {
    state = expectOk(
      await rpc(user, 'perform_encounter_action', { p_session_id: state.id, p_action: action, p_relaxed: true, p_expected_revision: state.revision }),
    )
  }
  return state
}

/** A paired session on `scenario` at the door, before the introduction. */
async function atTheDoor(missionary: TestUser, christian: TestUser, scenario: string): Promise<SessionState> {
  await h.resetRateLimits(missionary, christian)
  const created = expectOk(
    await rpc(missionary, 'create_pair', { p_scenario_id: scenario, p_version: 1, p_request_id: randomUUID(), p_role: 'missionary' }),
  )
  expectOk(await rpc(christian, 'join_pair', { p_code: created.pair_code, p_scenario_id: scenario, p_version: 1, p_request_id: randomUUID() }))
  return toTheDoor(missionary, christian, expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id })))
}

/** Introduction, one welcome reply, then the goodbye: the reflection screen. */
async function completed(missionary: TestUser, christian: TestUser, scenario: string): Promise<SessionState> {
  let state = await atTheDoor(missionary, christian, scenario)
  state = expectOk(await commit(missionary, state, 'introduction'))
  state = expectOk(await commit(christian, state, 'answer-1'))
  state = expectOk(await commit(missionary, state, 'closing'))
  expect(state).toMatchObject({ status: 'completed', stage: 'conclusion' })
  return state
}

describe('Hard mode', () => {
  it('only opens from reflection; a decline stays on the lesson; an accept moves both phones with the same roles', async () => {
    const [missionary, christian] = users
    let state = await atTheDoor(missionary, christian, LESSON)
    expectError(await requestHardMode(christian, state), 'invalid_state')

    state = await completed(missionary, christian, LESSON)
    const asked = expectOk(await requestHardMode(christian, state))
    expect(asked).toMatchObject({ restart_pending: true, restart_by_me: true, restart_hard_mode: true })
    expect(expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))).toMatchObject({
      restart_pending: true,
      restart_by_me: false,
      restart_hard_mode: true,
    })
    expectError(await respond(christian, asked, true), 'forbidden')

    const declined = expectOk(await respond(missionary, asked, false))
    expect(declined).toMatchObject({ scenario_id: LESSON, status: 'completed', round: state.round, restart_pending: false, restart_hard_mode: false })

    const again = expectOk(await requestHardMode(missionary, declined))
    const moved = expectOk(await respond(christian, again, true))
    expect(moved).toMatchObject({
      scenario_id: HARD,
      scenario_version: 1,
      status: 'active',
      stage: 'scene_setup',
      round: state.round + 1,
      my_role: 'christian',
      turn: 'missionary',
      history: [],
      restart_pending: false,
      restart_hard_mode: false,
    })
    expect(expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))).toMatchObject({ scenario_id: HARD, my_role: 'missionary' })

    // Hard mode plays two-sided: the missionary replies to the Christian's answer.
    let hard = await toTheDoor(missionary, christian, moved)
    hard = expectOk(await commit(missionary, hard, 'introduction'))
    hard = expectOk(await commit(christian, hard, 'answer-1'))
    hard = expectOk(await commit(missionary, hard, 'christianity'))
    hard = expectOk(await commit(christian, hard, 'christianity-eternal-son'))
    expect(hard.turn).toBe('missionary')
    expectError(await commit(missionary, hard, 'history'), 'invalid_input')
    hard = expectOk(await commit(missionary, hard, 'christianity-reply-who-jesus-is'))
    expect(hard.turn).toBe('missionary')
    hard = expectOk(await commit(missionary, hard, 'closing'))
    expect(hard).toMatchObject({ scenario_id: HARD, status: 'completed' })

    // Hard mode names no harder scenario of its own.
    expectError(await requestHardMode(missionary, hard), 'scenario_unavailable')
  })

  it('takes one of two simultaneous requests, and a cancel clears the Hard mode flag', async () => {
    const [missionary, christian] = users.slice(2, 4)
    const state = await completed(missionary, christian, LESSON)
    const [first, second] = await Promise.all([requestHardMode(missionary, state), requestHardMode(christian, state)])
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    const winner = first.ok ? missionary : christian
    const pending = expectOk(await rpc(winner, 'get_session', { p_session_id: state.id }))
    expect(pending.restart_hard_mode).toBe(true)

    const cancelled = expectOk(await rpc(winner, 'cancel_restart', { p_session_id: state.id, p_expected_revision: pending.revision }))
    expect(cancelled).toMatchObject({ scenario_id: LESSON, restart_pending: false, restart_hard_mode: false })

    // A plain Play again afterwards stays on the lesson.
    const replay = expectOk(await rpc(christian, 'request_restart', { p_session_id: state.id, p_expected_revision: cancelled.revision }))
    expect(replay.restart_hard_mode).toBe(false)
    const restarted = expectOk(await respond(missionary, replay, true))
    expect(restarted).toMatchObject({ scenario_id: LESSON, round: state.round + 1, stage: 'scene_setup' })
  })

  it('refuses when the named Hard mode is not published', async () => {
    const [missionary, christian] = users.slice(4, 6)
    const state = await completed(missionary, christian, ORPHAN)
    expectError(await requestHardMode(christian, state), 'scenario_unavailable')
  })
})
