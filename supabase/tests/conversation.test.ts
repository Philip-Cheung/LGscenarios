import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectError,
  expectOk,
  guided,
  Harness,
  rpc,
  SCENARIO_ID,
  SCENARIO_VERSION,
  TransportError,
  type SessionState,
  type TestUser,
} from './harness'

/**
 * A temporary copy of content/scenarios/week-one-christians-too.v1.json: schema
 * 3.0, five topics with two follow-ups each, with the clarification and "not
 * sure". v1 no longer takes new sessions, so the copy is registered under its
 * own id and an old publication date (never the featured scenario), and it is
 * deleted afterwards.
 */
const CONVERSATION = `test-conversation-${randomUUID().slice(0, 8)}`
const CONVERSATION_VERSION = 1

function testContent() {
  const file = JSON.parse(readFileSync('content/scenarios/week-one-christians-too.v1.json', 'utf8'))
  const { $schema: _schema, status: _status, ...content } = file
  return { ...content, id: CONVERSATION, version: CONVERSATION_VERSION }
}
const TOPICS: Record<string, string[]> = {
  christianity: ['christianity-call-us-christians', 'christianity-why-trinity'],
  history: ['history-ask-god-for-wisdom', 'history-authority-lost'],
  god: ['god-one-in-purpose', 'god-why-jesus-prays'],
  bible: ['bible-has-it-changed', 'bible-many-interpretations'],
  afterlife: ['afterlife-sun-moon-stars', 'afterlife-restored-ordinances'],
}

let h: Harness
let users: TestUser[]

beforeAll(async () => {
  h = new Harness()
  await h.sql(
    `insert into public.scenario_registry
       (scenario_id, version, slug, prompt_count, status, content, active_for_new_sessions, published_at)
     values ($1, $2, $1, 5, 'published', $3, true, '2000-01-01')`,
    [CONVERSATION, CONVERSATION_VERSION, testContent()],
  )
  users = await h.usersN(8)
})

afterAll(async () => {
  if (h) {
    await h.sql('delete from public.sessions where scenario_id = $1', [CONVERSATION])
    await h.sql('delete from public.scenario_registry where scenario_id = $1', [CONVERSATION])
    await h.cleanup()
  }
})

type Pick2 = Pick<SessionState, 'id' | 'revision'>

async function conversationPair(missionary: TestUser, christian: TestUser): Promise<SessionState> {
  await h.resetRateLimits(missionary, christian)
  const created = expectOk(
    await rpc(missionary, 'create_pair', {
      p_scenario_id: CONVERSATION,
      p_version: CONVERSATION_VERSION,
      p_request_id: randomUUID(),
      p_role: 'missionary',
    }),
  )
  expectOk(
    await rpc(christian, 'join_pair', {
      p_code: created.pair_code,
      p_scenario_id: CONVERSATION,
      p_version: CONVERSATION_VERSION,
      p_request_id: randomUUID(),
    }),
  )
  return expectOk(await rpc(missionary, 'get_session', { p_session_id: created.id }))
}

const setReady = (user: TestUser, state: Pick2, relaxed = false) =>
  rpc(user, 'set_ready', { p_session_id: state.id, p_relaxed: relaxed, p_expected_revision: state.revision })

const encounter = (user: TestUser, state: Pick2, action: string, relaxed = false) =>
  rpc(user, 'perform_encounter_action', {
    p_session_id: state.id,
    p_action: action,
    p_relaxed: relaxed,
    p_expected_revision: state.revision,
  })

const commit = (
  user: TestUser,
  state: Pick<SessionState, 'id' | 'revision' | 'round'>,
  itemId: string,
  commandId: string = randomUUID(),
) =>
  rpc(user, 'commit_utterance', {
    p_session_id: state.id,
    p_round: state.round,
    p_item_id: itemId,
    p_command_id: commandId,
    p_expected_revision: state.revision,
  })

/** Readies both players and plays the knock and open; returns the state at the start of the conversation. */
async function toConversation(missionary: TestUser, christian: TestUser, state: SessionState): Promise<SessionState> {
  const first = expectOk(await setReady(missionary, state))
  const both = expectOk(await setReady(christian, first))
  const started = expectOk(await encounter(missionary, both, 'start'))
  const knocked = expectOk(await encounter(missionary, started, 'knock'))
  return expectOk(await encounter(christian, knocked, 'open'))
}

/** Missionary speaks `itemId`, then the Christian answers with `reply`. */
async function exchange(
  missionary: TestUser,
  christian: TestUser,
  state: SessionState,
  itemId: string,
  reply = 'free',
): Promise<SessionState> {
  const spoken = expectOk(await commit(missionary, state, itemId))
  return expectOk(await commit(christian, spoken, reply))
}

describe('readiness', () => {
  it('records each player once, and goes active when both are ready', async () => {
    const [missionary, christian, outsider] = users
    const paired = await conversationPair(missionary, christian)
    expect(paired).toMatchObject({ status: 'ready', stage: 'paired', my_ready: false, turn: 'missionary', history: [] })

    expectError(await setReady(outsider, paired), 'not_found')
    expectError(await encounter(missionary, paired, 'start'), 'invalid_state')

    const mine = expectOk(await setReady(missionary, paired))
    expect(mine).toMatchObject({ status: 'ready', stage: 'scene_setup', my_ready: true, partner_ready: false })
    const again = expectOk(await setReady(missionary, paired))
    expect(again.revision).toBe(mine.revision)

    const both = expectOk(await setReady(christian, mine, true))
    expect(both).toMatchObject({ status: 'active', my_ready: true, partner_ready: true, encounter_relaxed: true })
    expectError(await encounter(christian, both, 'start'), 'forbidden')
  })

  it('refuses the conversation commands on guided sessions, and guided events on conversations', async () => {
    const [missionary, christian] = users.slice(2, 4)
    await h.resetRateLimits(missionary, christian)
    const guidedPair = await h.readyPair(missionary, christian)
    expectError(await setReady(missionary, guidedPair), 'invalid_state')

    const conversation = await conversationPair(missionary, christian)
    expectError(await guided(missionary, conversation, 'start_practice'), 'invalid_state')
  })
})

describe('the doorstep encounter', () => {
  it('lets only the missionary knock and only the Christian open, within the window', async () => {
    const [missionary, christian] = users.slice(0, 2)
    const paired = await conversationPair(missionary, christian)
    const both = expectOk(await setReady(christian, expectOk(await setReady(missionary, paired))))

    const started = expectOk(await encounter(missionary, both, 'start'))
    expect(started).toMatchObject({ stage: 'encounter', encounter_phase: 'knock', encounter_relaxed: false })
    const window = Date.parse(started.encounter_deadline ?? '') - Date.parse(started.server_now)
    expect(window).toBeGreaterThan(4500)
    expect(window).toBeLessThanOrEqual(5000)

    expectError(await encounter(christian, started, 'knock'), 'forbidden')
    expectError(await encounter(missionary, started, 'open'), 'forbidden')
    expectError(await encounter(christian, started, 'open'), 'invalid_state')
    // The window is still open, so there is nothing to retry.
    expectError(await encounter(missionary, started, 'retry'), 'invalid_state')

    const knocked = expectOk(await encounter(missionary, started, 'knock'))
    expect(knocked).toMatchObject({ stage: 'encounter', encounter_phase: 'open' })
    expectError(await encounter(missionary, knocked, 'open'), 'forbidden')
    expectError(await encounter(missionary, knocked, 'retry'), 'forbidden')

    // The Christian misses the window: the pair survives and the Christian retries.
    await h.sql("update public.sessions set encounter_deadline = now() - interval '3 seconds' where id = $1", [knocked.id])
    const missed = expectError(await encounter(christian, knocked, 'open'), 'deadline_passed')
    expect(missed).toMatchObject({ status: 'active', stage: 'encounter', encounter_phase: 'open' })
    const retried = expectOk(await encounter(christian, knocked, 'retry'))
    expect(retried).toMatchObject({ encounter_phase: 'open', encounter_relaxed: false })
    expect(Date.parse(retried.encounter_deadline ?? '')).toBeGreaterThan(Date.parse(retried.server_now))

    const opened = expectOk(await encounter(christian, retried, 'open'))
    expect(opened).toMatchObject({
      stage: 'conversation',
      status: 'active',
      encounter_phase: null,
      encounter_deadline: null,
      turn: 'missionary',
      history: [],
    })
  })

  it('drops the timer when a player chooses relaxed timing, even mid-window', async () => {
    const [missionary, christian] = users.slice(2, 4)
    const paired = await conversationPair(missionary, christian)
    const both = expectOk(await setReady(christian, expectOk(await setReady(missionary, paired))))
    const started = expectOk(await encounter(missionary, both, 'start'))
    expect(started.encounter_deadline).not.toBeNull()

    const relaxed = expectOk(await encounter(missionary, started, 'retry', true))
    expect(relaxed).toMatchObject({ encounter_phase: 'knock', encounter_relaxed: true, encounter_deadline: null })
    const knocked = expectOk(await encounter(missionary, relaxed, 'knock'))
    expect(knocked).toMatchObject({ encounter_phase: 'open', encounter_deadline: null })
    expectOk(await encounter(christian, knocked, 'open'))
  })
})

describe('speaking aloud', () => {
  it('alternates turns, validates every line against the content, and stores ids only', async () => {
    const [missionary, christian] = users.slice(4, 6)
    let state = await toConversation(missionary, christian, await conversationPair(missionary, christian))

    expectError(await commit(christian, state, 'free'), 'invalid_state')
    expectError(await commit(missionary, state, 'christianity'), 'invalid_input')
    expectError(await commit(missionary, state, 'Hello there'), 'invalid_input')

    state = expectOk(await commit(missionary, state, 'introduction'))
    expect(state).toMatchObject({ turn: 'christian', history: [{ speaker: 'missionary', id: 'introduction' }] })
    expectError(await commit(missionary, state, 'christianity'), 'invalid_state')
    // The opening has one suggested reply and nothing to be unsure about.
    expectError(await commit(christian, state, 'answer-2'), 'invalid_input')
    expectError(await commit(christian, state, 'not-sure'), 'invalid_input')
    expectError(await commit(christian, state, 'clarify'), 'invalid_input')
    state = expectOk(await commit(christian, state, 'answer-1'))
    expect(state.turn).toBe('missionary')

    // No topic yet: follow-ups and the clarification are not available.
    expectError(await commit(missionary, state, 'god-one-in-purpose'), 'invalid_input')
    expectError(await commit(missionary, state, 'clarify'), 'invalid_input')

    state = await exchange(missionary, christian, state, 'christianity', 'clarify')
    state = await exchange(missionary, christian, state, 'clarify', 'answer-1')
    // The clarification cannot be asked twice in a row.
    expectError(await commit(missionary, state, 'clarify'), 'invalid_input')
    // A follow-up must belong to the current topic.
    expectError(await commit(missionary, state, 'god-one-in-purpose'), 'invalid_input')
    state = await exchange(missionary, christian, state, 'christianity-call-us-christians', 'not-sure')
    // Spoken lines are never offered again.
    expectError(await commit(missionary, state, 'christianity'), 'invalid_input')
    expectError(await commit(missionary, state, 'christianity-call-us-christians'), 'invalid_input')
    expectError(await commit(missionary, state, 'introduction'), 'invalid_input')

    expect(state.history).toEqual([
      { speaker: 'missionary', id: 'introduction' },
      { speaker: 'christian', id: 'answer-1' },
      { speaker: 'missionary', id: 'christianity' },
      { speaker: 'christian', id: 'clarify' },
      { speaker: 'missionary', id: 'clarify' },
      { speaker: 'christian', id: 'answer-1' },
      { speaker: 'missionary', id: 'christianity-call-us-christians' },
      { speaker: 'christian', id: 'not-sure' },
    ])
    const { rows } = await h.sql<{ history: unknown }>('select history from public.sessions where id = $1', [state.id])
    expect(JSON.stringify(rows[0].history)).not.toMatch(/Latter-day|Christian myself/)
  })

  it('walks all five topics and ten follow-ups once each, then only the closing remains', async () => {
    const [missionary, christian] = users.slice(6, 8)
    let state = await toConversation(missionary, christian, await conversationPair(missionary, christian))
    state = await exchange(missionary, christian, state, 'introduction')

    for (const [topic, followUps] of Object.entries(TOPICS)) {
      state = await exchange(missionary, christian, state, topic, 'answer-1')
      for (const followUp of followUps) state = await exchange(missionary, christian, state, followUp)
    }
    expect(state.history).toHaveLength(32)
    for (const id of [...Object.keys(TOPICS), ...Object.values(TOPICS).flat()]) {
      expectError(await commit(missionary, state, id), 'invalid_input')
    }

    const done = expectOk(await commit(missionary, state, 'closing'))
    expect(done).toMatchObject({ status: 'completed', stage: 'conclusion' })
    expect(done.history.at(-1)).toEqual({ speaker: 'missionary', id: 'closing' })
    expectError(await commit(christian, done, 'free'), 'invalid_state')
    expectError(await commit(missionary, done, 'closing'), 'invalid_state')
  })

  it('commits a double-tapped send once, and lets one of two racing sends win', async () => {
    const [missionary, christian] = users.slice(0, 2)
    const state = await toConversation(missionary, christian, await conversationPair(missionary, christian))

    const commandId = randomUUID()
    const [first, second] = await Promise.all([
      commit(missionary, state, 'introduction', commandId),
      commit(missionary, state, 'introduction', commandId),
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const after = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(after.history).toEqual([{ speaker: 'missionary', id: 'introduction' }])
    expect(after.revision).toBe(state.revision + 1)

    const racing = await Promise.all([commit(christian, after, 'free'), commit(christian, after, 'answer-1')])
    expect(racing.filter((r) => r.ok)).toHaveLength(1)
    expect(racing.filter((r) => !r.ok && r.error === 'conflict')).toHaveLength(1)
    const settled = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(settled.history).toHaveLength(2)

    // A stale round is refused even with a fresh revision.
    expectError(await commit(missionary, { ...settled, round: settled.round + 1 }, 'christianity'), 'conflict')
  })

  it('waits for a disconnected partner instead of speaking past them', async () => {
    const [missionary, christian] = users.slice(2, 4)
    const state = await toConversation(missionary, christian, await conversationPair(missionary, christian))
    await h.sql(
      "update app_private.heartbeats set last_seen_at = now() - interval '5 minutes' where session_id = $1 and user_id = $2",
      [state.id, christian.id],
    )
    expectError(await commit(missionary, state, 'introduction'), 'partner_stale')
  })
})

describe('restart and role swap', () => {
  it('starts a new round with a clear history after an agreed restart', async () => {
    const [missionary, christian] = users.slice(4, 6)
    let state = await toConversation(missionary, christian, await conversationPair(missionary, christian))
    state = await exchange(missionary, christian, state, 'introduction')

    const asked = expectOk(
      await rpc(christian, 'request_restart', { p_session_id: state.id, p_expected_revision: state.revision }),
    )
    expectError(await commit(missionary, asked, 'christianity'), 'invalid_state')
    const restarted = expectOk(
      await rpc(missionary, 'respond_restart', { p_session_id: state.id, p_accept: true, p_expected_revision: asked.revision }),
    )
    expect(restarted).toMatchObject({
      round: state.round + 1,
      stage: 'scene_setup',
      turn: 'missionary',
      history: [],
      encounter_phase: null,
      my_ready: false,
      partner_ready: false,
    })
    const again = await toConversation(missionary, christian, restarted)
    expectOk(await commit(missionary, again, 'introduction'))
  })

  it('lets either player ask to swap mid-conversation; the other agrees, and the asker can cancel', async () => {
    const [missionary, christian, outsider] = users.slice(5, 8)
    let state = await toConversation(missionary, christian, await conversationPair(missionary, christian))
    state = await exchange(missionary, christian, state, 'introduction')

    const asked = expectOk(await rpc(christian, 'request_swap', { p_session_id: state.id, p_expected_revision: state.revision }))
    expect(asked).toMatchObject({ swap_pending: true, swap_by_me: true })
    expect(asked.swap_requested_at).not.toBeNull()
    const seen = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(seen).toMatchObject({ swap_pending: true, swap_by_me: false })
    expectError(await commit(missionary, seen, 'christianity'), 'invalid_state')
    expectError(await rpc(missionary, 'cancel_swap', { p_session_id: state.id, p_expected_revision: seen.revision }), 'forbidden')
    expectError(await rpc(outsider, 'cancel_swap', { p_session_id: state.id, p_expected_revision: seen.revision }), 'not_found')

    const cancelled = expectOk(await rpc(christian, 'cancel_swap', { p_session_id: state.id, p_expected_revision: seen.revision }))
    expect(cancelled).toMatchObject({ swap_pending: false, history: state.history })

    const askedAgain = expectOk(
      await rpc(missionary, 'request_swap', { p_session_id: state.id, p_expected_revision: cancelled.revision }),
    )
    const swapped = expectOk(
      await rpc(christian, 'respond_swap', { p_session_id: state.id, p_accept: true, p_expected_revision: askedAgain.revision }),
    )
    expect(swapped).toMatchObject({
      my_role: 'missionary',
      status: 'ready',
      stage: 'paired',
      round: state.round + 1,
      turn: 'missionary',
      history: [],
      swap_pending: false,
    })
    // The former Christian now leads the conversation.
    const again = await toConversation(christian, missionary, swapped)
    expectError(await commit(missionary, again, 'introduction'), 'invalid_state')
    expectOk(await commit(christian, again, 'introduction'))
  })

  it('expires an unanswered swap request after a minute', async () => {
    const [missionary, christian] = users.slice(0, 2)
    const state = await toConversation(missionary, christian, await conversationPair(missionary, christian))
    const asked = expectOk(await rpc(missionary, 'request_swap', { p_session_id: state.id, p_expected_revision: state.revision }))
    await h.sql("update public.sessions set swap_requested_at = now() - interval '61 seconds' where id = $1", [state.id])
    const stale = expectOk(await rpc(christian, 'get_session', { p_session_id: state.id }))
    expect(stale.swap_pending).toBe(false)
    const answered = expectError(
      await rpc(christian, 'respond_swap', { p_session_id: state.id, p_accept: true, p_expected_revision: asked.revision }),
      'conflict',
    )
    expect(answered).toMatchObject({ swap_pending: false, my_role: 'christian' })
    const cleared = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expectOk(await commit(missionary, cleared, 'introduction'))
  })
})

describe('pairing and access', () => {
  it('refuses a code from a different scenario link or version', async () => {
    const [missionary, christian] = users.slice(2, 4)
    await h.resetRateLimits(missionary, christian)
    const created = expectOk(
      await rpc(missionary, 'create_pair', {
        p_scenario_id: CONVERSATION,
        p_version: CONVERSATION_VERSION,
        p_request_id: randomUUID(),
        p_role: 'missionary',
      }),
    )
    const code = created.pair_code ?? ''
    expectError(
      await rpc(christian, 'join_pair', {
        p_code: code,
        p_scenario_id: SCENARIO_ID,
        p_version: SCENARIO_VERSION,
        p_request_id: randomUUID(),
      }),
      'scenario_mismatch',
    )
    expectError(
      await rpc(christian, 'join_pair', {
        p_code: code,
        p_scenario_id: CONVERSATION,
        p_version: CONVERSATION_VERSION + 1,
        p_request_id: randomUUID(),
      }),
      'scenario_mismatch',
    )
    const joined = expectOk(
      await rpc(christian, 'join_pair', {
        p_code: code,
        p_scenario_id: CONVERSATION,
        p_version: CONVERSATION_VERSION,
        p_request_id: randomUUID(),
      }),
    )
    expect(joined).toMatchObject({ scenario_id: CONVERSATION, my_role: 'christian' })
  })

  it('keeps the conversation commands away from outsiders and signed-out callers', async () => {
    const [missionary, christian, outsider] = users.slice(4, 7)
    const state = await toConversation(missionary, christian, await conversationPair(missionary, christian))
    expectError(await setReady(outsider, state), 'not_found')
    expectError(await encounter(outsider, state, 'retry'), 'not_found')
    expectError(await commit(outsider, state, 'introduction'), 'not_found')

    const anon = h.anonymousClient()
    await expect(
      rpc(anon, 'commit_utterance', {
        p_session_id: state.id,
        p_round: state.round,
        p_item_id: 'introduction',
        p_command_id: randomUUID(),
        p_expected_revision: state.revision,
      }),
    ).rejects.toBeInstanceOf(TransportError)

    const after = expectOk(await rpc(missionary, 'get_session', { p_session_id: state.id }))
    expect(after.history).toEqual([])
  })
})
