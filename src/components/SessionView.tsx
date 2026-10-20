import { useEffect, useRef, useState, type Ref } from 'react'
import type { ScenarioContent } from '../lib/content'
import { formatPairCode, spellPairCode } from '../lib/pairCode'
import { isPartnerAway } from '../sessions/snapshot'
import type { SessionSnapshot } from '../sessions/types'
import type { ConnectionState, PendingAction, SessionActions } from '../sessions/useSessionSync'
import { PromptCard } from './PromptCard'
import { ROLE_LABELS } from './roles'
import { Button, Card, StatusMessage } from './ui'
import { useDelayedFlag } from './useDelayedFlag'
import styles from './screens.module.css'

export interface SessionViewProps {
  scenario: ScenarioContent
  snapshot: SessionSnapshot
  connection: ConnectionState
  pending: PendingAction | null
  notice: string | null
  actions: SessionActions
  onLeave(): void
}

const CONNECTION_MESSAGE_DELAY_MS = 800

/** Renders the participant's current card from validated session state only. */
export function SessionView({ scenario, snapshot, connection, pending, notice, actions, onLeave }: SessionViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const showConnection = useDelayedFlag(connection !== 'live', CONNECTION_MESSAGE_DELAY_MS)
  const partnerAway = snapshot.status !== 'waiting' && isPartnerAway(snapshot)
  const canAct = connection === 'live' && pending === null

  let statusText = notice ?? ''
  if (partnerAway) statusText = 'Waiting for your partner to reconnect'
  if (showConnection) statusText = connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'

  // Move focus to the new heading when the shared step changes, not on first render or heartbeats.
  const viewKey = `${snapshot.status}:${snapshot.round}:${snapshot.promptIndex}:${snapshot.myRole}`
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [viewKey])

  switch (snapshot.status) {
    case 'waiting':
      return (
        <WaitingCard
          snapshot={snapshot}
          statusText={statusText}
          canAct={canAct}
          pending={pending}
          headingRef={headingRef}
          onRegenerate={actions.regenerateCode}
          onLeave={onLeave}
        />
      )
    case 'ready':
      return (
        <Card aria-labelledby="lobby-heading">
          <div className={styles.cardBody}>
            <p className={styles.meta}>
              <span>{ROLE_LABELS[snapshot.myRole]}</span>
              <span>Paired</span>
            </p>
            <h2 id="lobby-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
              {snapshot.myRole === 'missionary' ? 'Your partner has joined' : 'Waiting for your partner to start'}
            </h2>
            <p className={styles.muted}>
              {snapshot.myRole === 'missionary'
                ? 'You read each prompt aloud and move to the next one.'
                : 'You answer each prompt. You can show a suggested answer on your phone.'}
            </p>
            <div className={styles.footer}>
              <StatusMessage>{statusText}</StatusMessage>
              {snapshot.myRole === 'missionary' ? (
                <Button block disabled={!canAct || partnerAway} loading={pending === 'start'} onClick={actions.start}>
                  Start
                </Button>
              ) : (
                <p className={`${styles.muted} ${styles.reserved}`}>Your partner controls next and back.</p>
              )}
            </div>
          </div>
        </Card>
      )
    case 'active':
      return (
        <PromptCard
          key={viewKey}
          scenario={scenario}
          role={snapshot.myRole}
          promptIndex={snapshot.promptIndex}
          statusText={statusText}
          canAct={canAct && !partnerAway}
          pending={pending}
          headingRef={headingRef}
          onBack={actions.back}
          onNext={actions.next}
          onFinish={actions.finish}
        />
      )
    case 'completed':
      return (
        <FinishCard
          snapshot={snapshot}
          statusText={statusText}
          canAct={canAct}
          partnerAway={partnerAway}
          pending={pending}
          headingRef={headingRef}
          actions={actions}
        />
      )
    case 'expired':
      return null
  }
}

interface WaitingCardProps {
  snapshot: SessionSnapshot
  statusText: string
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  onRegenerate(): void
  onLeave(): void
}

function WaitingCard({ snapshot, statusText, canAct, pending, headingRef, onRegenerate, onLeave }: WaitingCardProps) {
  const codeExpired = useHasPassed(snapshot.codeExpiresAt ?? null) || !snapshot.pairCode
  const isMissionary = snapshot.myRole === 'missionary'

  return (
    <Card aria-labelledby="waiting-heading">
      <div className={styles.cardBody}>
        <p className={styles.meta}>
          <span>{ROLE_LABELS[snapshot.myRole]}</span>
          <span>Pairing</span>
        </p>
        {isMissionary ? (
          <>
            <h2 id="waiting-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
              {codeExpired ? 'This code has expired' : 'Share this code with your partner'}
            </h2>
            {!codeExpired && snapshot.pairCode ? (
              <p className={styles.code} data-testid="pair-code" translate="no">
                <span aria-hidden="true">{formatPairCode(snapshot.pairCode)}</span>
                <span className={styles.visuallyHidden}>Code: {spellPairCode(snapshot.pairCode)}</span>
              </p>
            ) : null}
            <p className={styles.muted}>
              {codeExpired
                ? 'Get a new code, then share it with your partner.'
                : 'They choose Christian on their phone and enter this code. Codes last 15 minutes.'}
            </p>
            <p className={styles.muted}>Stay in this browser. If you switch browsers, you will need a new pair.</p>
          </>
        ) : (
          <h2 id="waiting-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
            Connecting to your partner
          </h2>
        )}
        <div className={styles.footer}>
          <StatusMessage>{statusText || (codeExpired ? '' : 'Waiting for your partner to join…')}</StatusMessage>
          {isMissionary && codeExpired ? (
            <Button block disabled={!canAct} loading={pending === 'regenerate'} onClick={onRegenerate}>
              Get a new code
            </Button>
          ) : null}
          <Button block variant="secondary" onClick={onLeave}>
            Start over
          </Button>
        </div>
      </div>
    </Card>
  )
}

interface FinishCardProps {
  snapshot: SessionSnapshot
  statusText: string
  canAct: boolean
  partnerAway: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  actions: SessionActions
}

function FinishCard({ snapshot, statusText, canAct, partnerAway, pending, headingRef, actions }: FinishCardProps) {
  const isMissionary = snapshot.myRole === 'missionary'
  let explanation: string
  if (isMissionary) {
    explanation = snapshot.swapPending
      ? 'Waiting for your partner to accept the switch.'
      : 'Switch roles to practise the other side.'
  } else {
    explanation = snapshot.swapPending
      ? 'Your partner wants to switch roles. You would become the Mormon missionary.'
      : 'Your partner can offer to switch roles.'
  }

  return (
    <Card aria-labelledby="finish-heading">
      <div className={styles.cardBody}>
        <p className={styles.meta}>
          <span>{ROLE_LABELS[snapshot.myRole]}</span>
          <span>Round {snapshot.round}</span>
        </p>
        <h2 id="finish-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
          Scenario complete
        </h2>
        <p className={styles.muted} role="status">
          {explanation}
        </p>
        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
          {isMissionary && !snapshot.swapPending ? (
            <Button block disabled={!canAct} loading={pending === 'requestSwap'} onClick={actions.requestSwap}>
              Switch roles
            </Button>
          ) : null}
          {!isMissionary && snapshot.swapPending ? (
            <div className={styles.nav}>
              <Button
                variant="secondary"
                disabled={!canAct}
                loading={pending === 'declineSwap'}
                onClick={actions.declineSwap}
              >
                Decline
              </Button>
              <Button disabled={!canAct || partnerAway} loading={pending === 'acceptSwap'} onClick={actions.acceptSwap}>
                Accept
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

/** True once the given ISO timestamp is in the past; re-renders at that moment. */
function useHasPassed(iso: string | null): boolean {
  const target = iso ? Date.parse(iso) : Number.NaN
  const [passedTarget, setPassedTarget] = useState<number | null>(null)
  useEffect(() => {
    if (Number.isNaN(target)) return
    const remaining = Math.max(0, target - Date.now())
    const timer = window.setTimeout(() => setPassedTarget(target), Math.min(remaining, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [target])
  return passedTarget === target
}
