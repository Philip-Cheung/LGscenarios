import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectError, expectOk, Harness, rpc, type SessionState, type TestUser } from './harness'

/**
 * Schema 3.1 replies, against a temporary copy of the draft
 * content/scenarios/week-one-christians-too.v2.json. The copy is registered
 * under its own id and an old publication date, so it is never the featured
 * scenario, and it is deleted afterwards.
 */
const SCENARIO = `test-two-sided-${randomUUID().slice(0, 8)}`
/** A reply that asks the Christian something, added to the Trinity follow-up for these tests only. */
const ASKING_REPLY = 'test-reply-asks'
const ASKING_ANSWER = 'test-reply-asks-answer'

function testContent() {
  const file = JSON.parse(readFileSync('content/scenarios/week-one-christians-too.v2.json', 'utf8'))
  const { $schema: _schema, status: _status, ...content } = file
  const trinity = content.topics[0].followUps.find((f: { id: string }) => f.id === 'christianity-why-trinity')
  trinity.respond.replies.push({
    id: ASKING_REPLY,
    label: 'Ask what they mean',
    text: 'Which part of that matters most to you?',
    next: 'christian-response',
    help: { hint: 'Say what matters most to you.', answers: [{ id: ASKING_ANSWER, text: 'That Jesus is fully God.' }] },
  })
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
  // The opening keeps its positional welcome reply.
  return expectOk(await commit(christian, state, 'answer-1'))
}

describe('replying to the Christian (schema 3.1)', () => {
  it('answers an authored response before the next question, then lets the missionary continue', async () => {
    const [missionary, christian] = users
    let state = await talking(missionary, christian)

    state = expectOk(await commit(missionary, state, 'christianity'))
    // 3.1 answers have their own ids; positional ids are refused.
    expectError(await commit(christian, state, 'answer-1'), 'invalid_input')
    state = expectOk(await commit(christian, state, 'christianity-eternal-son'))
    expect(state.turn).toBe('missionary')

    // The missionary owes a reply: no new question, follow-up, or another line's reply yet.
    expectError(await commit(missionary, state, 'history'), 'invalid_input')
    expectError(await commit(missionary, state, 'christianity-call-us-christians'), 'invalid_input')
    expectError(await commit(missionary, state, 'christianity-reply-godhead'), 'invalid_input')
    expectError(await commit(christian, state, 'free'), 'invalid_state')

    state = expectOk(await commit(missionary, state, 'christianity-reply-who-jesus-is'))
    expect(state.turn).toBe('missionary')
    // Replied: replies and own words are no longer open, and the topic is kept.
    expectError(await commit(missionary, state, 'christianity-reply-compare'), 'invalid_input')
    expectError(await commit(missionary, state, 'free'), 'invalid_input')
    state = expectOk(await commit(missionary, state, 'christianity-call-us-christians'))
    expect(state.turn).toBe('christian')

    expect(state.history).toEqual([
      { speaker: 'missionary', id: 'introduction' },
      { speaker: 'christian', id: 'answer-1' },
      { speaker: 'missionary', id: 'christianity' },
      { speaker: 'christian', id: 'christianity-eternal-son' },
      { speaker: 'missionary', id: 'christianity-reply-who-jesus-is' },
      { speaker: 'missionary', id: 'christianity-call-us-christians' },
    ])
  })

  it('lets the missionary pick any reply or their own words after a free answer, and skips replies where none are written', async () => {
    const [missionary, christian] = users.slice(2, 4)
    let state = await talking(missionary, christian)

    state = expectOk(await commit(missionary, state, 'christianity'))
    state = expectOk(await commit(christian, state, 'free'))
    state = expectOk(await commit(missionary, state, 'christianity-reply-read-together'))
    expect(state.turn).toBe('missionary')

    state = expectOk(await commit(missionary, state, 'christianity-why-trinity'))
    state = expectOk(await commit(christian, state, 'not-sure'))
    state = expectOk(await commit(missionary, state, 'free'))
    expect(state.turn).toBe('missionary')

    // The history topic has no replies yet, so the missionary goes straight on.
    state = expectOk(await commit(missionary, state, 'history'))
    state = expectOk(await commit(christian, state, 'history-a1'))
    expectError(await commit(missionary, state, 'free'), 'invalid_input')
    state = expectOk(await commit(missionary, state, 'history-ask-god-for-wisdom'))
    expect(state.turn).toBe('christian')
  })

  it('hands the turn over for the clarification, returns to the same line, and never asks it twice in a row', async () => {
    const [missionary, christian] = users
    let state = await talking(missionary, christian)

    state = expectOk(await commit(missionary, state, 'christianity'))
    state = expectOk(await commit(christian, state, 'free'))
    state = expectOk(await commit(missionary, state, 'clarify'))
    expect(state.turn).toBe('christian')
    state = expectOk(await commit(christian, state, 'answer-1'))

    expectError(await commit(missionary, state, 'clarify'), 'invalid_input')
    expectError(await commit(missionary, state, 'christianity-reply-godhead'), 'invalid_input')
    state = expectOk(await commit(missionary, state, 'christianity-reply-compare'))
    expect(state.turn).toBe('missionary')
    expectOk(await commit(missionary, state, 'christianity-why-trinity'))
  })

  it('hands the turn over for a reply that asks something, then returns to the same line', async () => {
    const [missionary, christian] = users.slice(2, 4)
    let state = await talking(missionary, christian)

    state = expectOk(await commit(missionary, state, 'christianity'))
    state = expectOk(await commit(christian, state, 'christianity-compare-meaning'))
    state = expectOk(await commit(missionary, state, 'christianity-reply-compare'))
    state = expectOk(await commit(missionary, state, 'christianity-why-trinity'))
    state = expectOk(await commit(christian, state, 'christianity-trinity-one-being'))

    state = expectOk(await commit(missionary, state, ASKING_REPLY))
    expect(state.turn).toBe('christian')
    expectError(await commit(christian, state, 'christianity-trinity-one-being'), 'invalid_input')
    state = expectOk(await commit(christian, state, ASKING_ANSWER))

    expectError(await commit(missionary, state, 'christianity-reply-who-jesus-is'), 'invalid_input')
    state = expectOk(await commit(missionary, state, 'christianity-reply-godhead'))
    expect(state.turn).toBe('missionary')
  })

  it('commits a double-tapped reply once, and a restart clears a pending reply', async () => {
    const [missionary, christian] = users
    let state = await talking(missionary, christian)
    state = expectOk(await commit(missionary, state, 'christianity'))
    state = expectOk(await commit(christian, state, 'christianity-eternal-son'))

    const commandId = randomUUID()
    const [first, second] = await Promise.all([
      commit(missionary, state, 'christianity-reply-who-jesus-is', commandId),
      commit(missionary, state, 'christianity-reply-who-jesus-is', commandId),
    ])
    expect(first.ok && second.ok).toBe(true)
    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after.history.filter((entry) => entry.id === 'christianity-reply-who-jesus-is')).toHaveLength(1)
    expect(after.revision).toBe(state.revision + 1)
    // A stale revision cannot reply twice.
    expectError(await commit(missionary, state, 'christianity-reply-compare'), 'conflict')

    state = expectOk(await commit(missionary, after, 'christianity-why-trinity'))
    state = expectOk(await commit(christian, state, 'free'))
    const asked = expectOk(await rpc(christian, 'request_restart', { p_session_id: state.id, p_expected_revision: state.revision }))
    expectError(await commit(missionary, asked, 'christianity-reply-godhead'), 'invalid_state')
    const restarted = expectOk(
      await rpc(missionary, 'respond_restart', { p_session_id: state.id, p_accept: true, p_expected_revision: asked.revision }),
    )
    expect(restarted).toMatchObject({ round: state.round + 1, turn: 'missionary', history: [] })
    expectError(await commit(missionary, restarted, 'christianity-reply-godhead'), 'invalid_state')
  })
})
