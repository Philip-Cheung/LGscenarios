import { useState } from 'react'
import { EndedCard } from '../components/EndedCard'
import { JoinForm } from '../components/JoinForm'
import { PageShell } from '../components/PageShell'
import { RoleSelect } from '../components/RoleSelect'
import { SessionView } from '../components/SessionView'
import type { ScenarioContent } from '../lib/content'
import { coffeeChat, whoIsGod } from '../scenarios/fixtures'
import type { SessionSnapshot } from '../sessions/types'
import type { ConnectionState, SessionActions } from '../sessions/useSessionSync'

/**
 * Development-only gallery of every screen state, rendered from local scenario
 * files with no backend. Used for visual and accessibility review. Never shipped.
 */
const base: SessionSnapshot = {
  id: '00000000-0000-4000-8000-000000000000',
  scenarioId: whoIsGod.id,
  scenarioVersion: whoIsGod.version,
  status: 'active',
  revision: 1,
  round: 1,
  myRole: 'missionary',
  partnerJoined: true,
  swapPending: false,
  restartPending: false,
  restartRequestedAt: null,
  stage: 'scene_setup',
  meReady: false,
  partnerReady: false,
  triggerInitiated: false,
  activeQuestionId: null,
  activeFollowupId: null,
  questionAsked: false,
  partnerFresh: true,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  pairCode: null,
  codeExpiresAt: null,
}

const noop = async () => true
const actions: SessionActions = {
  send: noop,
  requestSwap: noop,
  acceptSwap: noop,
  declineSwap: noop,
  regenerateCode: noop,
  end: noop,
  requestRestart: noop,
  acceptRestart: noop,
  declineRestart: noop,
  cancelRestart: noop,
}

const discussing = { stage: 'discussion' as const, activeQuestionId: 'nature-of-god' }

const STATES: Record<
  string,
  { snapshot?: Partial<SessionSnapshot>; connection?: ConnectionState; screen?: string; scenario?: ScenarioContent }
> = {
  'role-select': { screen: 'role-select' },
  'join': { screen: 'join' },
  'join-error': { screen: 'join-error' },
  'waiting': {
    snapshot: {
      status: 'waiting',
      partnerJoined: false,
      partnerFresh: null,
      pairCode: 'K7MPQ3',
      codeExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    },
  },
  'waiting-expired': {
    snapshot: { status: 'waiting', partnerJoined: false, partnerFresh: null, pairCode: null, codeExpiresAt: new Date(0).toISOString() },
  },
  'scene-missionary': { snapshot: { status: 'ready' } },
  'scene-christian-partner-ready': { snapshot: { status: 'ready', myRole: 'christian', partnerReady: true } },
  'scene-waiting': { snapshot: { status: 'ready', meReady: true } },
  'trigger-missionary': { snapshot: { stage: 'interaction_trigger' } },
  'trigger-christian-waiting': { snapshot: { stage: 'interaction_trigger', myRole: 'christian' } },
  'trigger-christian-knock': { snapshot: { stage: 'interaction_trigger', myRole: 'christian', triggerInitiated: true } },
  'trigger-cafe-christian': { scenario: coffeeChat, snapshot: { stage: 'interaction_trigger', myRole: 'christian' } },
  'opening-missionary': { snapshot: { stage: 'opening_dialogue' } },
  'opening-christian': { snapshot: { stage: 'opening_dialogue', myRole: 'christian' } },
  'select-missionary': { snapshot: { stage: 'question_selection' } },
  'select-christian': { snapshot: { stage: 'question_selection', myRole: 'christian' } },
  'ask-missionary': { snapshot: discussing },
  'ask-christian': { snapshot: { ...discussing, myRole: 'christian' } },
  'discuss-missionary': { snapshot: { ...discussing, questionAsked: true } },
  'discuss-christian': { snapshot: { ...discussing, questionAsked: true, myRole: 'christian' } },
  'followup-missionary': { snapshot: { ...discussing, activeFollowupId: 'jesus-prays' } },
  'followup-christian': {
    snapshot: { ...discussing, activeFollowupId: 'jesus-prays', questionAsked: true, myRole: 'christian' },
  },
  'partner-away': { snapshot: { ...discussing, partnerFresh: false } },
  'reconnecting': { snapshot: discussing, connection: 'reconnecting' },
  'complete-missionary': { snapshot: { status: 'completed', stage: 'conclusion' } },
  'complete-christian-request': {
    snapshot: { status: 'completed', stage: 'conclusion', myRole: 'christian', swapPending: true },
  },
  'restart-christian': {
    snapshot: { ...discussing, myRole: 'christian', restartPending: true, restartRequestedAt: new Date().toISOString() },
  },
  'ended': { screen: 'ended' },
}

export default function DevPreview() {
  const initial = new URLSearchParams(window.location.search).get('state') ?? 'scene-missionary'
  const [state, setState] = useState(initial in STATES ? initial : 'scene-missionary')
  const entry = STATES[state]
  const scenario = entry.scenario ?? whoIsGod

  let content
  if (entry.screen === 'role-select') content = <RoleSelect busyRole={null} error={null} onChoose={() => {}} />
  else if (entry.screen === 'join') content = <JoinForm busy={false} error={null} onJoin={() => {}} onBack={() => {}} />
  else if (entry.screen === 'join-error')
    content = (
      <JoinForm
        initialValue="ABC-DEF"
        busy={false}
        error="That code is not valid or is no longer available. Check it with your partner."
        onJoin={() => {}}
        onBack={() => {}}
      />
    )
  else if (entry.screen === 'ended') content = <EndedCard reason="expired" onStartOver={() => {}} />
  else
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

  return (
    <PageShell
      title={scenario.title}
      description={entry.screen === 'role-select' ? scenario.subtitle : undefined}
      compactTitle={entry.screen !== 'role-select'}
    >
      <label>
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
      {content}
    </PageShell>
  )
}
