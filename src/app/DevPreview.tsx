import { useState } from 'react'
import { EndedCard, type EndedReason } from '../components/EndedCard'
import { JoinForm } from '../components/JoinForm'
import { PageShell } from '../components/PageShell'
import { RoleSelect } from '../components/RoleSelect'
import { ConversationSession } from '../components/conversation/ConversationSession'
import { SessionView } from '../components/SessionView'
import { Welcome } from '../components/Welcome'
import type { ScenarioContent } from '../lib/content'
import { christiansToo, coffeeChat, sampleDoorstep, weekOne, whoIsGod } from '../scenarios/fixtures'
import type { SessionSnapshot } from '../sessions/types'
import type { ConnectionState, SessionActions } from '../sessions/useSessionSync'

/**
 * Development-only gallery of every screen state, rendered from local scenario
 * files with no backend. Used for visual and accessibility review. Never shipped.
 */
const base: SessionSnapshot = {
  id: '00000000-0000-4000-8000-000000000000',
  scenarioId: sampleDoorstep.id,
  scenarioVersion: sampleDoorstep.version,
  status: 'active',
  revision: 1,
  round: 1,
  myRole: 'missionary',
  isCreator: true,
  partnerJoined: true,
  swapPending: false,
  swapByMe: false,
  swapRequestedAt: null,
  restartPending: false,
  restartByMe: false,
  restartRequestedAt: null,
  stage: 'scene_setup',
  meReady: false,
  partnerReady: false,
  activeQuestionId: null,
  answeredQuestionIds: [],
  openingQuestionAsked: false,
  exchange: 'initial',
  turn: 'missionary',
  history: [],
  encounterPhase: null,
  encounterDeadline: null,
  encounterRelaxed: false,
  serverNow: undefined,
  partnerFresh: true,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  pairCode: null,
  codeExpiresAt: null,
}

const noop = async () => true
const actions: SessionActions = {
  send: noop,
  setReady: noop,
  encounter: noop,
  commit: noop,
  requestSwap: noop,
  acceptSwap: noop,
  declineSwap: noop,
  cancelSwap: noop,
  regenerateCode: noop,
  end: noop,
  requestRestart: noop,
  acceptRestart: noop,
  declineRestart: noop,
  cancelRestart: noop,
}

const responding = { stage: 'response' as const, activeQuestionId: 'hope' }

interface PreviewState {
  snapshot?: Partial<SessionSnapshot>
  connection?: ConnectionState
  screen?: 'welcome' | 'welcome-notice' | 'role-select' | 'join' | 'join-error' | EndedReason
  scenario?: ScenarioContent
  /** Renders the "We're Christians too" conversation (schema 3.0) instead of a guided scenario. */
  conversation?: boolean
}

const talking = { status: 'active' as const, stage: 'conversation' as const, encounterRelaxed: true }
const introduced = [
  { speaker: 'missionary' as const, id: 'introduction' },
  { speaker: 'christian' as const, id: 'answer-1' },
]

const STATES: Record<string, PreviewState> = {
  'welcome': { screen: 'welcome' },
  'welcome-notice': { screen: 'welcome-notice' },
  'role-select': { screen: 'role-select' },
  'join': { screen: 'join' },
  'join-error': { screen: 'join-error' },
  'invite': {
    snapshot: {
      status: 'waiting',
      stage: 'paired',
      partnerJoined: false,
      partnerFresh: null,
      pairCode: '482716',
      codeExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    },
  },
  'invite-christian': {
    snapshot: {
      status: 'waiting',
      stage: 'paired',
      myRole: 'christian',
      partnerJoined: false,
      partnerFresh: null,
      pairCode: '482716',
      codeExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    },
  },
  'invite-expired': {
    snapshot: {
      status: 'waiting',
      stage: 'paired',
      partnerJoined: false,
      partnerFresh: null,
      pairCode: null,
      codeExpiresAt: new Date(0).toISOString(),
    },
  },
  'paired-missionary': { snapshot: { status: 'ready', stage: 'paired' } },
  'paired-christian': { snapshot: { status: 'ready', stage: 'paired', myRole: 'christian', isCreator: false } },
  'paired-christian-creator': { snapshot: { status: 'ready', stage: 'paired', myRole: 'christian' } },
  'scene-missionary': { snapshot: { status: 'ready' } },
  'scene-christian-partner-ready': { snapshot: { status: 'ready', myRole: 'christian', partnerReady: true } },
  'scene-waiting': { snapshot: { status: 'ready', meReady: true } },
  'scene-cafe': { scenario: coffeeChat, snapshot: { status: 'ready' } },
  'ready-missionary': { snapshot: { stage: 'ready_together', meReady: true, partnerReady: true } },
  'ready-christian': { snapshot: { stage: 'ready_together', myRole: 'christian', meReady: true, partnerReady: true } },
  'opening-missionary': { snapshot: { stage: 'opening_dialogue' } },
  'opening-christian': { snapshot: { stage: 'opening_dialogue', myRole: 'christian' } },
  'questions-missionary': { snapshot: { stage: 'question_selection' } },
  'questions-one-answered': { snapshot: { stage: 'question_selection', answeredQuestionIds: ['hope'] } },
  'questions-all-answered': {
    snapshot: { stage: 'question_selection', answeredQuestionIds: sampleDoorstep.questions.map((item) => item.id) },
  },
  'questions-christian': { snapshot: { stage: 'question_selection', myRole: 'christian' } },
  'questions-who-is-god': { scenario: whoIsGod, snapshot: { stage: 'question_selection' } },
  'response-missionary': { snapshot: responding },
  'response-christian': { snapshot: { ...responding, myRole: 'christian' } },
  'response-scriptures': {
    scenario: whoIsGod,
    snapshot: { stage: 'response', activeQuestionId: 'nature-of-god', myRole: 'christian' },
  },
  'closing-missionary': { snapshot: { stage: 'closing' } },
  'closing-christian': { snapshot: { stage: 'closing', myRole: 'christian' } },
  'paused': { snapshot: { ...responding, partnerFresh: false } },
  'reconnecting': { snapshot: responding, connection: 'reconnecting' },
  'complete-missionary': { snapshot: { status: 'completed', stage: 'conclusion' } },
  'complete-christian': { snapshot: { status: 'completed', stage: 'conclusion', myRole: 'christian' } },
  'complete-swap-request': {
    snapshot: { status: 'completed', stage: 'conclusion', myRole: 'christian', swapPending: true },
  },
  'restart-requested': {
    snapshot: { ...responding, restartPending: true, restartByMe: true, restartRequestedAt: new Date().toISOString() },
  },
  'restart-asked': {
    snapshot: { ...responding, myRole: 'christian', restartPending: true, restartRequestedAt: new Date().toISOString() },
  },
  'week-scene': { scenario: weekOne, snapshot: { status: 'ready' } },
  'week-opening-missionary': { scenario: weekOne, snapshot: { stage: 'opening_dialogue' } },
  'week-opening-christian': {
    scenario: weekOne,
    snapshot: { stage: 'opening_dialogue', myRole: 'christian', openingQuestionAsked: true },
  },
  'week-questions-first': { scenario: weekOne, snapshot: { stage: 'question_selection', openingQuestionAsked: true } },
  'week-response-christian': {
    scenario: weekOne,
    snapshot: { stage: 'response', activeQuestionId: 'first-vision', myRole: 'christian', openingQuestionAsked: true },
  },
  'week-follow-up-missionary': {
    scenario: weekOne,
    snapshot: { stage: 'question_selection', activeQuestionId: 'accounts', exchange: 'follow_up', openingQuestionAsked: true },
  },
  'week-follow-up-christian': {
    scenario: weekOne,
    snapshot: {
      stage: 'response',
      activeQuestionId: 'accounts',
      exchange: 'follow_up',
      myRole: 'christian',
      openingQuestionAsked: true,
    },
  },
  'week-questions-answered': {
    scenario: weekOne,
    snapshot: { stage: 'question_selection', openingQuestionAsked: true, answeredQuestionIds: ['faith', 'accounts'] },
  },
  'conversation-missionary-next': { conversation: true, snapshot: { ...talking, history: introduced } },
  'conversation-missionary-follow-up': {
    conversation: true,
    snapshot: {
      ...talking,
      history: [...introduced, { speaker: 'missionary', id: 'christianity' }, { speaker: 'christian', id: 'free' }],
    },
  },
  'conversation-christian-waiting': { conversation: true, snapshot: { ...talking, myRole: 'christian', history: introduced } },
  'left': { screen: 'left' },
  'partner-left': { screen: 'partnerLeft' },
  'expired': { screen: 'expired' },
}

export default function DevPreview() {
  const initial = new URLSearchParams(window.location.search).get('state') ?? 'scene-missionary'
  const [state, setState] = useState(initial in STATES ? initial : 'scene-missionary')
  const entry = STATES[state]
  const scenario = entry.scenario ?? sampleDoorstep

  let content
  if (entry.screen === 'welcome' || entry.screen === 'welcome-notice') {
    content = (
      <Welcome
        notice={entry.screen === 'welcome-notice' ? 'Your partner ended the practice.' : null}
        onCreate={() => {}}
        onJoin={() => {}}
      />
    )
  } else if (entry.screen === 'role-select') {
    content = <RoleSelect scenario={scenario} busy={false} error={null} onCreate={() => {}} onBack={() => {}} />
  } else if (entry.screen === 'join') {
    content = <JoinForm busy={false} error={null} onJoin={() => {}} onBack={() => {}} />
  } else if (entry.screen === 'join-error') {
    content = (
      <JoinForm
        initialValue="482 761"
        busy={false}
        error="That code doesn’t match an open practice. Check your partner’s screen and try again."
        onJoin={() => {}}
        onBack={() => {}}
      />
    )
  } else if (entry.screen) {
    content = <EndedCard reason={entry.screen} onStartOver={() => {}} />
  } else {
    content = (
      <SessionView
        key={state}
        scenario={scenario}
        snapshot={{ ...base, scenarioId: scenario.id, scenarioVersion: scenario.version, ...entry.snapshot }}
        connection={entry.connection ?? 'live'}
        pending={null}
        notice={null}
        actions={actions}
      />
    )
  }

  const picker = (
    <label style={{ display: 'block', marginBottom: 16, fontSize: '0.875rem' }}>
      <span style={{ marginRight: 8 }}>Preview state</span>
      <select
        value={state}
        onChange={(event) => {
          setState(event.target.value)
          window.history.replaceState(null, '', `?state=${event.target.value}`)
        }}
      >
        {Object.keys(STATES).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </label>
  )

  if (entry.conversation) {
    return (
      <>
        <div style={{ padding: '8px 16px 0' }}>{picker}</div>
        <ConversationSession
          key={state}
          content={christiansToo}
          snapshot={{ ...base, scenarioId: christiansToo.id, scenarioVersion: christiansToo.version, ...entry.snapshot }}
          connection="live"
          pending={null}
          notice={null}
          lastError={null}
          actions={actions}
          clockOffsetMs={0}
          resumed
        />
      </>
    )
  }

  return (
    <PageShell>
      {picker}
      {content}
    </PageShell>
  )
}
