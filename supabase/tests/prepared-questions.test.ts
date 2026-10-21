import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, Harness, rpc, type SessionState, type TestUser } from './harness'

/**
 * Prepared questions only, against a temporary copy of
 * content/scenarios/week-one-christians-too.v3.json: no clarification, no
 * "not sure", one authored answer per question. The copy is registered under
 * its own id and an old publication date, so it is never the featured
 * scenario, and it is deleted afterwards.
 */
const SCENARIO = `test-prepared-${randomUUID().slice(0, 8)}`

function testContent() {
  const file = JSON.parse(readFileSync('content/scenarios/week-one-christians-too.v3.json', 'utf8'))
  const { $schema: _schema, status: _status, ...content } = file
  return { ...content, id: SCENARIO, version: 1 }
}

let h: Harness
let users: TestUser[]

beforeAll(async () => {
  h = new Harness()
  await h.sql(
    `insert into public.scenario_registry
       (scenario_id, version, slug, prompt_count, status, content, active_for_new_sessions, published_at)
     values ($1, 1, $1, 5, 'published', $2, true, '2000-01-01')`,
    [SCENARIO, testContent()],
  )
  users = await h.usersN(4)
})

afterAll(async () => {
  if (h) {
    await h.sql('delete from public.sessions where scenario_id = $1', [SCENARIO])
    await h.sql('delete from public.scenario_registry where scenario_id = $1', [SCENARIO])
    await h.cleanup()
  }
})

type Revisioned = Pick<SessionState, 'id' | 'revision' | 'round'>

const commit = (user: TestUser, state: Revisioned, itemId: string, commandId: string = randomUUID()) =>
  rpc(user, 'commit_utterance', {
    p_session_id: state.id,
    p_round: state.round,
    p_item_id: itemId,
    p_command_id: commandId,
    p_expected_revision: state.revision,
  })

/** A paired, readied session at the start of the conversation, after the introduction and its welcome. */
async function talking(missionary: TestUser, christian: TestUser): Promise<SessionState> {
  await h.resetRateLimits(missionary, christian)
  const created = expectOk(
    await rpc(missionary, 'create_pair', { p_scenario_id: SCENARIO, p_version: 1, p_request_id: randomUUID(), p_role: 'missionary' }),
  )
  expectOk(await rpc(christian, 'join_pair', { p_code: created.pair_code, p_scenario_id: SCENARIO, p_version: 1, p_request_id: randomUUID() }))
  let state = expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id }))
  state = expectOk(await rpc(missionary, 'set_ready', { p_session_id: state.id, p_relaxed: true, p_expected_revision: state.revision }))
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
  state = expectOk(await commit(missionary, state, 'introduction'))
  return expectOk(await commit(christian, state, 'answer-1'))
}

describe('prepared questions only (week one v2)', () => {
  it('returns the turn to the missionary after each answer, who asks the next prepared question', async () => {
    const [missionary, christian] = users
    let state = await talking(missionary, christian)

    state = expectOk(await commit(missionary, state, 'christianity'))
    // Only the one authored answer or the Christian's own words.
    expectError(await commit(christian, state, 'answer-2'), 'invalid_input')
    expectError(await commit(christian, state, 'not-sure'), 'invalid_input')
    expectError(await commit(christian, state, 'clarify'), 'invalid_input')
    state = expectOk(await commit(christian, state, 'answer-1'))
    expect(state.turn).toBe('missionary')

    // No clarification and no improvised reply: the missionary asks the next prepared question.
    expectError(await commit(missionary, state, 'clarify'), 'invalid_input')
    expectError(await commit(missionary, state, 'free'), 'invalid_input')
    state = expectOk(await commit(missionary, state, 'christianity-call-us-christians'))
    expect(state.turn).toBe('christian')
    state = expectOk(await commit(christian, state, 'free'))
    expect(state.turn).toBe('missionary')

    expect(state.history).toEqual([
      { speaker: 'missionary', id: 'introduction' },
      { speaker: 'christian', id: 'answer-1' },
      { speaker: 'missionary', id: 'christianity' },
      { speaker: 'christian', id: 'answer-1' },
      { speaker: 'missionary', id: 'christianity-call-us-christians' },
      { speaker: 'christian', id: 'free' },
    ])
    // A refresh or reconnect reads the same committed turn.
    const reread = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(reread).toMatchObject({ turn: 'missionary', revision: state.revision, history: state.history })
  })

  it('commits a double-tapped answer once and refuses a stale revision', async () => {
    const [missionary, christian] = users.slice(2, 4)
    let state = await talking(missionary, christian)
    state = expectOk(await commit(missionary, state, 'god'))

    const commandId = randomUUID()
    const [first, second] = await Promise.all([
      commit(christian, state, 'answer-1', commandId),
      commit(christian, state, 'answer-1', commandId),
    ])
    expect(first.ok && second.ok).toBe(true)
    const after = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(after.history.filter((entry) => entry.speaker === 'christian')).toHaveLength(2)
    expect(after).toMatchObject({ turn: 'missionary', revision: state.revision + 1 })
    expectError(await commit(christian, state, 'free'), 'conflict')
  })

  it('reaches the closing once every prepared question has been asked', async () => {
    const [missionary, christian] = users
    let state = await talking(missionary, christian)
    for (const topic of testContent().topics) {
      for (const beat of [topic.question, ...topic.followUps]) {
        state = expectOk(await commit(missionary, state, beat.id))
        state = expectOk(await commit(christian, state, 'answer-1'))
      }
    }
    expect(state.history).toHaveLength(2 + 15 * 2)
    expectError(await commit(missionary, state, 'christianity'), 'invalid_input')
    const closed = expectOk(await commit(missionary, state, 'closing'))
    expect(closed).toMatchObject({ status: 'completed', stage: 'conclusion' })
  })

  it('starts a clean round after a restart and after a role swap', async () => {
    const [missionary, christian] = users.slice(2, 4)
    let state = await talking(missionary, christian)
    state = expectOk(await commit(missionary, state, 'history'))
    state = expectOk(await commit(christian, state, 'answer-1'))

    const asked = expectOk(await rpc(christian, 'request_restart', { p_session_id: state.id, p_expected_revision: state.revision }))
    const restarted = expectOk(
      await rpc(missionary, 'respond_restart', { p_session_id: state.id, p_accept: true, p_expected_revision: asked.revision }),
    )
    expect(restarted).toMatchObject({ round: state.round + 1, turn: 'missionary', history: [] })

    const swap = expectOk(await rpc(missionary, 'request_swap', { p_session_id: state.id, p_expected_revision: restarted.revision }))
    const swapped = expectOk(await rpc(christian, 'respond_swap', { p_session_id: state.id, p_accept: true, p_expected_revision: swap.revision }))
    expect(swapped).toMatchObject({ round: restarted.round + 1, history: [], my_role: 'missionary' })
  })
})
