import { useEffect, useRef, useState, type Ref } from 'react'
import type { ScenarioContent } from '../lib/content'
import { formatPairCode, spellPairCode } from '../lib/pairCode'
import { messageForEndFailure } from '../sessions/messages'
import { isPartnerAway, isRestartCurrent, RESTART_TIMEOUT_MS } from '../sessions/snapshot'
import type { SessionErrorCode, SessionSnapshot } from '../sessions/types'
import type { ConnectionState, PendingAction, SessionActions } from '../sessions/useSessionSync'
import { PromptCard } from './PromptCard'
import { ROLE_LABELS } from './roles'
import { Button, Card, ConfirmDialog, StatusMessage } from './ui'
import { useDelayedFlag } from './useDelayedFlag'
import styles from './screens.module.css'

export interface SessionViewProps {
  scenario: ScenarioContent
  snapshot: SessionSnapshot
  connection: ConnectionState
  pending: PendingAction | null
  notice: string | null
  lastError?: SessionErrorCode | null
  actions: SessionActions
}

const CONNECTION_MESSAGE_DELAY_MS = 800

/** Renders the participant's current card from validated session state only. */
export function SessionView({
  scenario,
  snapshot,
  connection,
  pending,
  notice,
  lastError = null,
  actions,
}: SessionViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const showConnection = useDelayedFlag(connection !== 'live', CONNECTION_MESSAGE_DELAY_MS)
  const partnerAway = snapshot.status !== 'waiting' && isPartnerAway(snapshot)
  const restartLive = useRestartLive(snapshot)
  const controlsLocked = connection !== 'live' || pending !== null || restartLive
  const canAct = !controlsLocked && !partnerAway
  const canSelect = connection === 'live' && pending === null && !restartLive
  const [exitOpen, setExitOpen] = useState(false)
  const [exitOffline, setExitOffline] = useState(false)
  const [exitFailed, setExitFailed] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)

  let statusText = notice ?? ''
  if (showConnection) statusText = connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'

  const openExit = () => {
    setExitOffline(false)
    setExitFailed(false)
    setExitOpen(true)
  }

  // Move focus to the new heading when the shared step changes, not on heartbeats.
  const viewKey = `${snapshot.status}:${snapshot.round}:${snapshot.promptIndex}:${snapshot.myRole}:${snapshot.selectedBranchId ?? ''}`
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [viewKey])

  const showRestart =
    snapshot.myRole === 'missionary' &&
    (snapshot.status === 'active' || snapshot.status === 'completed') &&
    !snapshot.swapPending

  const exitDescription = partnerAway
    ? 'Your partner is disconnected. This closes the scenario for both of you. You can start a new pair afterward.'
    : 'This ends the scenario for both players. You can start a new pair afterward.'

  const confirmEnd = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setExitOffline(true)
      setExitFailed(true)
      return
    }
    setExitOffline(false)
    const ok = await actions.end()
    if (!ok) setExitFailed(true)
  }

  return (
    <>
      {snapshot.status === 'waiting' ? null : (
        <div className={styles.sessionBar}>
          {showRestart && !restartLive ? (
            <button type="button" className={`${styles.textAction} ${styles.textActionQuiet}`} onClick={() => setRestartOpen(true)}>
              Restart
            </button>
          ) : null}
          <button type="button" className={styles.textAction} onClick={openExit}>
            Exit
          </button>
        </div>
      )}
      {partnerAway ? (
        <div className={styles.notice} role="region" aria-labelledby="partner-away-heading">
          <h2 id="partner-away-heading" className={styles.heading}>
            Your partner is disconnected
          </h2>
          <p className={styles.muted}>You can end the session for both of you.</p>
          <Button variant="destructive" block onClick={openExit}>
            End session
          </Button>
        </div>
      ) : null}
      {renderBody()}
      {exitOpen ? (
        <ConfirmDialog
          title="End this session?"
          description={exitDescription}
          confirmLabel="End session"
          destructive
          pending={pending === 'end'}
          error={exitFailed ? messageForEndFailure(exitOffline, exitOffline ? null : lastError) : null}
          onConfirm={() => void confirmEnd()}
          onCancel={() => {
            if (pending === 'end') return
            setExitOpen(false)
            setExitOffline(false)
            setExitFailed(false)
          }}
        />
      ) : null}
      {restartOpen ? (
        <ConfirmDialog
          title="Restart this scenario?"
          description="Both players will return to the first prompt and keep their roles. Your partner will be asked to confirm."
          confirmLabel="Ask to restart"
          pending={pending === 'requestRestart'}
          error={pending === 'requestRestart' ? null : notice}
          onConfirm={() => {
            void actions.requestRestart().then((ok) => {
              if (ok) setRestartOpen(false)
            })
          }}
          onCancel={() => {
            if (pending === 'requestRestart') return
            setRestartOpen(false)
          }}
        />
      ) : null}
    </>
  )

  function renderBody() {
    switch (snapshot.status) {
      case 'waiting':
        return (
          <WaitingCard
            snapshot={snapshot}
            statusText={statusText}
            canAct={connection === 'live' && pending === null}
            pending={pending}
            headingRef={headingRef}
            onRegenerate={actions.regenerateCode}
            onBack={actions.end}
          />
        )
      case 'ready':
        return (
          <Card className={styles.enter} aria-labelledby="lobby-heading">
            <div className={styles.cardBody}>
              <p className={styles.meta}>
                <span>{ROLE_LABELS[snapshot.myRole]}</span>
                <span>Paired</span>
              </p>
              <h1 id="lobby-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
                {snapshot.myRole === 'missionary' ? <JoinedMark /> : null}
                {snapshot.myRole === 'missionary' ? 'Your partner has joined' : 'Waiting for your partner to start'}
              </h1>
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
                  <p className={`${styles.guidance} ${styles.reserved}`}>Your partner moves to the next prompt.</p>
                )}
              </div>
            </div>
          </Card>
        )
      case 'active':
        return (
          <>
            {restartLive ? (
              <RestartNotice
                snapshot={snapshot}
                canAct={connection === 'live' && pending === null}
                pending={pending}
                actions={actions}
              />
            ) : null}
            <PromptCard
              key={viewKey}
              scenario={scenario}
              role={snapshot.myRole}
              promptIndex={snapshot.promptIndex}
              selectedBranchId={snapshot.selectedBranchId}
              statusText={statusText}
              canAct={canAct}
              canSelect={canSelect}
              partnerAway={partnerAway}
              pending={pending}
              headingRef={headingRef}
              onBack={actions.back}
              onNext={actions.next}
              onFinish={actions.finish}
              onSelectBranch={(branchId) => void actions.selectBranch(branchId)}
            />
          </>
        )
      case 'completed':
        return (
          <>
            {restartLive ? (
              <RestartNotice
                snapshot={snapshot}
                canAct={connection === 'live' && pending === null}
                pending={pending}
                actions={actions}
              />
            ) : null}
            <FinishCard
              snapshot={snapshot}
              statusText={statusText}
              canAct={canAct}
              partnerAway={partnerAway}
              pending={pending}
              headingRef={headingRef}
              actions={actions}
            />
          </>
        )
      case 'expired':
      case 'ended':
        return null
    }
  }
}

function JoinedMark() {
  return (
    <svg className={styles.check} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 10.2 8.6 13 14 7.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

interface WaitingCardProps {
  snapshot: SessionSnapshot
  statusText: string
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  onRegenerate(): void
  /** Closes the pairing code on the server; the screen leaves once it is ended. */
  onBack(): Promise<boolean>
}

function WaitingCard({ snapshot, statusText, canAct, pending, headingRef, onRegenerate, onBack }: WaitingCardProps) {
  const codeExpired = useHasPassed(snapshot.codeExpiresAt ?? null) || !snapshot.pairCode
  const isMissionary = snapshot.myRole === 'missionary'
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [backOffline, setBackOffline] = useState(false)

  const goBack = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setBackOffline(true)
      return
    }
    setBackOffline(false)
    void onBack()
  }

  const copyCode = async () => {
    if (!snapshot.pairCode) return
    try {
      await navigator.clipboard.writeText(formatPairCode(snapshot.pairCode))
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopied(false)
      setCopyError(true)
    }
  }

  return (
    <Card className={styles.enter} aria-labelledby="waiting-heading">
      <div className={styles.cardBody}>
        <p className={styles.meta}>
          <span>{ROLE_LABELS[snapshot.myRole]}</span>
          <span>Pairing</span>
        </p>
        {isMissionary ? (
          <>
            <h1 id="waiting-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
              {codeExpired ? 'This code has expired' : 'Share this code with your partner'}
            </h1>
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
          <h1 id="waiting-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
            Connecting to your partner
          </h1>
        )}
        <div className={styles.footer}>
          <StatusMessage>
            {statusText ||
              (codeExpired
                ? ''
                : copyError
                  ? 'Could not copy. Select the code and copy it.'
                  : copied
                    ? 'Code copied.'
                    : 'Waiting for your partner to join…')}
          </StatusMessage>
          {isMissionary && !codeExpired && snapshot.pairCode ? (
            <Button variant="secondary" block onClick={() => void copyCode()}>
              Copy code
            </Button>
          ) : null}
          {isMissionary && codeExpired ? (
            <Button block disabled={!canAct} loading={pending === 'regenerate'} onClick={onRegenerate}>
              Get a new code
            </Button>
          ) : null}
          <Button
            variant="secondary"
            block
            disabled={pending !== null && pending !== 'end'}
            loading={pending === 'end'}
            onClick={goBack}
          >
            Back to roles
          </Button>
          <StatusMessage tone="error">
            {backOffline ? 'You are offline. Your code cannot be closed until your connection returns.' : null}
          </StatusMessage>
        </div>
      </div>
    </Card>
  )
}

function RestartNotice({
  snapshot,
  canAct,
  pending,
  actions,
}: {
  snapshot: SessionSnapshot
  canAct: boolean
  pending: PendingAction | null
  actions: SessionActions
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  if (snapshot.myRole === 'missionary') {
    return (
      <div className={styles.notice} role="region" aria-labelledby="restart-waiting-heading">
        <h2 id="restart-waiting-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
          Waiting for your partner…
        </h2>
        <Button variant="secondary" disabled={!canAct} loading={pending === 'cancelRestart'} onClick={actions.cancelRestart}>
          Cancel request
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.notice} role="region" aria-labelledby="restart-request-heading">
      <h2 id="restart-request-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
        Your partner wants to restart.
      </h2>
      <p className={styles.muted}>You’ll both return to the first prompt and keep your roles.</p>
      <div className={styles.stack}>
        <Button
          block
          variant="secondary"
          disabled={!canAct}
          loading={pending === 'declineRestart'}
          onClick={actions.declineRestart}
        >
          Keep playing
        </Button>
        <Button block disabled={!canAct} loading={pending === 'acceptRestart'} onClick={actions.acceptRestart}>
          Restart scenario
        </Button>
      </div>
    </div>
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
    <Card className={styles.enter} aria-labelledby="finish-heading">
      <div className={styles.cardBody}>
        <p className={styles.meta}>
          <span>{ROLE_LABELS[snapshot.myRole]}</span>
          <span>Round {snapshot.round}</span>
        </p>
        <h1 id="finish-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
          <JoinedMark />
          Scenario complete
        </h1>
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

function useRestartLive(snapshot: SessionSnapshot): boolean {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!snapshot.restartPending || !snapshot.restartRequestedAt) return
    const at = Date.parse(snapshot.restartRequestedAt)
    if (Number.isNaN(at)) return
    const remaining = at + RESTART_TIMEOUT_MS - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setTick((value) => value + 1), remaining)
    return () => window.clearTimeout(timer)
  }, [snapshot.restartPending, snapshot.restartRequestedAt])
  return snapshot.restartPending && isRestartCurrent(snapshot.restartRequestedAt)
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
