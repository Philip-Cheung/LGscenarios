import { useState } from 'react'
import { EndedCard } from '../components/EndedCard'
import { JoinForm } from '../components/JoinForm'
import { PageShell } from '../components/PageShell'
import { RoleSelect } from '../components/RoleSelect'
import { SessionView } from '../components/SessionView'
import { sampleDoorstepV1 } from '../scenarios/sample-doorstep.v1'
import type { SessionSnapshot } from '../sessions/types'
import type { ConnectionState, SessionActions } from '../sessions/useSessionSync'

/**
 * Development-only gallery of every screen state, rendered from fixtures with
 * no backend. Used for visual and accessibility review. Never shipped.
 */
const base: SessionSnapshot = {
  id: '00000000-0000-4000-8000-000000000000',
  scenarioId: sampleDoorstepV1.scenarioId,
  scenarioVersion: sampleDoorstepV1.version,
  status: 'active',
  promptIndex: 0,
  revision: 1,
  round: 1,
  myRole: 'missionary',
  partnerJoined: true,
  swapPending: false,
  partnerFresh: true,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  pairCode: null,
  codeExpiresAt: null,
}

const noop = async () => true
const actions: SessionActions = {
  start: noop,
  next: noop,
  back: noop,
  finish: noop,
  requestSwap: noop,
  acceptSwap: noop,
  declineSwap: noop,
  regenerateCode: noop,
}

const STATES: Record<string, { snapshot?: Partial<SessionSnapshot>; connection?: ConnectionState; screen?: string }> = {
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
  'ready-missionary': { snapshot: { status: 'ready' } },
  'ready-christian': { snapshot: { status: 'ready', myRole: 'christian' } },
  'missionary-first': { snapshot: {} },
  'missionary-last': { snapshot: { promptIndex: 2 } },
  'christian': { snapshot: { myRole: 'christian', promptIndex: 1 } },
  'partner-away': { snapshot: { promptIndex: 1, partnerFresh: false } },
  'reconnecting': { snapshot: { promptIndex: 1 }, connection: 'reconnecting' },
  'complete-missionary': { snapshot: { status: 'completed', promptIndex: 2 } },
  'complete-christian-request': { snapshot: { status: 'completed', promptIndex: 2, myRole: 'christian', swapPending: true } },
  'ended': { screen: 'ended' },
}

export default function DevPreview() {
  const initial = new URLSearchParams(window.location.search).get('state') ?? 'missionary-first'
  const [state, setState] = useState(initial in STATES ? initial : 'missionary-first')
  const entry = STATES[state]

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
        scenario={sampleDoorstepV1}
        snapshot={{ ...base, ...entry.snapshot }}
        connection={entry.connection ?? 'live'}
        pending={null}
        notice={null}
        actions={actions}
        onLeave={() => {}}
      />
    )

  return (
    <PageShell title={sampleDoorstepV1.title}>
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
