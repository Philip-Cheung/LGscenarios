import { useEffect, useRef, useState, type Ref } from 'react'
import { DEFAULT_REFLECTION_PROMPT, type ScenarioContent } from '../lib/content'
import { formatPairCode, spellPairCode } from '../lib/pairCode'
import { messageForEndFailure } from '../sessions/messages'
import { isPartnerAway, isRestartCurrent, RESTART_TIMEOUT_MS } from '../sessions/snapshot'
import type { SessionErrorCode, SessionSnapshot } from '../sessions/types'
import type { ConnectionState, PendingAction, SessionActions } from '../sessions/useSessionSync'
import { AppScreen, ProgressMeta, SessionMenu, type ScreenFrame } from './AppScreen'
import { ActivityDots, BubblesArt, Icon } from './art'
import { GuidedStage, PairSummary } from './GuidedStage'
import { otherRole, ROLE_SHORT_LABELS } from './roles'
import { Button, ConfirmDialog, StatusMessage } from './ui'
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
  /** Supabase URL that serves setting images from Storage. */
  imageBaseUrl?: string
  /** True when this browser reopened a pair it was already seated in. */
  resumed?: boolean
}

const CONNECTION_MESSAGE_DELAY_MS = 800

/** Renders the participant's current screen from validated session state only. */
export function SessionView({
  scenario,
  snapshot,
  connection,
  pending,
  notice,
  lastError = null,
  actions,
  imageBaseUrl = '',
  resumed = false,
}: SessionViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const showConnection = useDelayedFlag(connection !== 'live', CONNECTION_MESSAGE_DELAY_MS)
  const partnerAway = snapshot.status !== 'waiting' && isPartnerAway(snapshot)
  const restartLive = useRestartLive(snapshot)
  const canAct = connection === 'live' && pending === null && !restartLive && !partnerAway
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

  // A new shared step replays the entrance and moves focus to its heading; heartbeats do not.
  const viewKey = [
    snapshot.status,
    snapshot.round,
    snapshot.stage,
    snapshot.myRole,
    snapshot.activeQuestionId ?? '',
    snapshot.exchange,
    snapshot.openingQuestionAsked,
    snapshot.swapPending,
    partnerAway,
    restartLive,
  ].join(':')
  const shownViewKey = useRef(viewKey)
  useEffect(() => {
    if (shownViewKey.current === viewKey) return
    shownViewKey.current = viewKey
    headingRef.current?.focus()
  }, [viewKey])

  const canRestart =
    (snapshot.status === 'active' || snapshot.status === 'completed') && !snapshot.swapPending && !restartLive

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

  const roleLabel = ROLE_SHORT_LABELS[snapshot.myRole]
  const meta =
    snapshot.status === 'waiting' || snapshot.stage === 'paired' ? undefined : (
      <ProgressMeta
        roleLabel={roleLabel}
        stage={snapshot.stage}
        followUp={snapshot.exchange === 'follow_up' && snapshot.activeQuestionId !== null}
      />
    )

  const frame: ScreenFrame = {
    menu:
      snapshot.status === 'waiting' ? undefined : (
        <SessionMenu onRestart={canRestart ? () => setRestartOpen(true) : undefined} onLeave={openExit} />
      ),
    meta,
    status: <StatusMessage className={styles.statusLine}>{statusText}</StatusMessage>,
  }

  return (
    <>
      {renderBody()}
      {exitOpen ? (
        <ConfirmDialog
          title="Leave this session?"
          description={
            partnerAway
              ? 'Your partner is offline. This will close the practice for both of you.'
              : 'This will close the practice for both people.'
          }
          confirmLabel="Leave session"
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
          title="Start again?"
          description="You’ll both return to the scene and keep your roles. Your partner will be asked to confirm."
          confirmLabel="Start again"
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
    if (snapshot.status === 'expired' || snapshot.status === 'ended') return null
    if (snapshot.status === 'waiting') {
      return (
        <WaitingScreen
          scenario={scenario}
          snapshot={snapshot}
          frame={frame}
          viewKey={viewKey}
          canAct={connection === 'live' && pending === null}
          pending={pending}
          headingRef={headingRef}
          resumed={resumed}
          onRegenerate={actions.regenerateCode}
          onBack={actions.end}
        />
      )
    }
    if (partnerAway) {
      return (
        <AppScreen
          {...frame}
          viewKey={viewKey}
          waiting
          note="Neither person will move ahead while the connection is paused."
          actions={
            <Button variant="secondary" onClick={openExit}>
              Leave session
            </Button>
          }
        >
          <BubblesArt />
          <span className={styles.turn}>Practice paused</span>
          <h1 ref={headingRef} tabIndex={-1}>
            Your partner is offline
          </h1>
          <p>Your place is saved. Continue when you’re both connected again.</p>
        </AppScreen>
      )
    }
    if (restartLive) {
      return snapshot.restartByMe ? (
        <AppScreen
          {...frame}
          viewKey={viewKey}
          waiting
          actions={
            <Button
              variant="secondary"
              disabled={connection !== 'live' || pending !== null}
              loading={pending === 'cancelRestart'}
              onClick={actions.cancelRestart}
            >
              Cancel request
            </Button>
          }
        >
          <BubblesArt />
          <h1 ref={headingRef} tabIndex={-1}>
            Waiting for your partner
          </h1>
          <p>You asked to start again. You’ll both return to the scene and keep your roles.</p>
          <ActivityDots />
        </AppScreen>
      ) : (
        <AppScreen
          {...frame}
          viewKey={viewKey}
          waiting
          actions={
            <>
              <Button
                disabled={connection !== 'live' || pending !== null}
                loading={pending === 'acceptRestart'}
                onClick={actions.acceptRestart}
              >
                Start again
              </Button>
              <Button
                variant="secondary"
                disabled={connection !== 'live' || pending !== null}
                loading={pending === 'declineRestart'}
                onClick={actions.declineRestart}
              >
                Keep practising
              </Button>
            </>
          }
        >
          <BubblesArt />
          <h1 ref={headingRef} tabIndex={-1}>
            Start again?
          </h1>
          <p>Your partner would like to start this practice again. You’ll both return to the scene and keep your roles.</p>
        </AppScreen>
      )
    }
    if (snapshot.status === 'completed') {
      return (
        <Completion
          scenario={scenario}
          snapshot={snapshot}
          frame={frame}
          viewKey={viewKey}
          canAct={canAct}
          pending={pending}
          headingRef={headingRef}
          actions={actions}
          onPracticeAgain={() => setRestartOpen(true)}
        />
      )
    }
    return (
      <GuidedStage
        scenario={scenario}
        snapshot={snapshot}
        frame={frame}
        viewKey={viewKey}
        canAct={canAct}
        pending={pending}
        headingRef={headingRef}
        imageBaseUrl={imageBaseUrl}
        onSend={(event, targetId) => void actions.send(event, targetId)}
      />
    )
  }
}

interface WaitingScreenProps {
  scenario: ScenarioContent
  snapshot: SessionSnapshot
  frame: ScreenFrame
  viewKey: string
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  resumed: boolean
  onRegenerate(): void
  /** Closes the pairing code on the server; the screen leaves once it is ended. */
  onBack(): Promise<boolean>
}

function WaitingScreen({
  scenario,
  snapshot,
  frame,
  viewKey,
  canAct,
  pending,
  headingRef,
  resumed,
  onRegenerate,
  onBack,
}: WaitingScreenProps) {
  const codeExpired = useHasPassed(snapshot.codeExpiresAt ?? null) || !snapshot.pairCode
  const [backOffline, setBackOffline] = useState(false)

  const goBack = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setBackOffline(true)
      return
    }
    setBackOffline(false)
    void onBack()
  }

  const changeRoles = (
    <Button
      variant="text"
      disabled={pending !== null && pending !== 'end'}
      loading={pending === 'end'}
      onClick={goBack}
    >
      Change roles
    </Button>
  )

  return (
    <AppScreen
      {...frame}
      status={
        <>
          {frame.status}
          <StatusMessage tone="error" className={styles.statusLine}>
            {backOffline ? 'You are offline. Your code cannot be closed until your connection returns.' : null}
          </StatusMessage>
        </>
      }
      viewKey={`${viewKey}:${codeExpired}`}
      note="Keep this screen open while your partner joins."
      actions={
        codeExpired ? (
          <>
            <Button disabled={!canAct} loading={pending === 'regenerate'} onClick={onRegenerate}>
              Get a new code
            </Button>
            {changeRoles}
          </>
        ) : (
          changeRoles
        )
      }
    >
      <span className={styles.turn}>
        <Icon />
        Invite your partner
      </span>
      {codeExpired ? (
        <h1 ref={headingRef} tabIndex={-1}>
          This code has expired.
        </h1>
      ) : (
        <h1 ref={headingRef} tabIndex={-1} className={styles.srOnly}>
          Invite your partner
        </h1>
      )}
      {codeExpired ? (
        <p>Get a new code, then share it with your partner.</p>
      ) : (
        <>
          {resumed ? (
            <p>
              Ask your partner to choose <strong>Join your partner</strong> on their own phone and enter this code.
            </p>
          ) : (
            <p>
              Ask your partner to choose <strong>Join your partner</strong> and enter this code.
            </p>
          )}
          {snapshot.pairCode ? (
            <div className={styles.pairCode} translate="no">
              <span>YOUR PAIRING CODE</span>
              <strong data-testid="pair-code" aria-hidden="true">
                {formatPairCode(snapshot.pairCode)}
              </strong>
              <span className={styles.srOnly}>Code: {spellPairCode(snapshot.pairCode)}</span>
              <small>Share with the person beside you. Codes last 15 minutes.</small>
            </div>
          ) : null}
          <div className={styles.status}>
            <span className={`${styles.statusDot} ${styles.statusDotPending}`} aria-hidden="true" />
            Waiting for your partner to join
            <ActivityDots />
          </div>
        </>
      )}
      <PairSummary
        rows={[
          ['Your role', scenario.roles[snapshot.myRole].label],
          ['Your partner’s role', scenario.roles[otherRole(snapshot.myRole)].label],
        ]}
      />
    </AppScreen>
  )
}

interface CompletionProps {
  scenario: ScenarioContent
  snapshot: SessionSnapshot
  frame: ScreenFrame
  viewKey: string
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  actions: SessionActions
  onPracticeAgain(): void
}

function Completion({
  scenario,
  snapshot,
  frame,
  viewKey,
  canAct,
  pending,
  headingRef,
  actions,
  onPracticeAgain,
}: CompletionProps) {
  const isMissionary = snapshot.myRole === 'missionary'
  const practiceAgain = (
    <Button disabled={!canAct} onClick={onPracticeAgain}>
      Practise again
    </Button>
  )
  let note: string | undefined
  let footer = null
  if (isMissionary) {
    if (snapshot.swapPending) {
      note = 'Waiting for your partner to accept the switch.'
    } else {
      footer = (
        <>
          {practiceAgain}
          <Button variant="secondary" disabled={!canAct} loading={pending === 'requestSwap'} onClick={actions.requestSwap}>
            Switch roles
          </Button>
        </>
      )
    }
  } else if (snapshot.swapPending) {
    note = `Your partner would like to switch. You’d practise as the ${scenario.roles.missionary.label}.`
    footer = (
      <>
        <Button disabled={!canAct} loading={pending === 'acceptSwap'} onClick={actions.acceptSwap}>
          Switch roles
        </Button>
        <Button variant="secondary" disabled={!canAct} loading={pending === 'declineSwap'} onClick={actions.declineSwap}>
          Not now
        </Button>
      </>
    )
  } else {
    footer = practiceAgain
  }

  return (
    <AppScreen {...frame} viewKey={viewKey} waiting note={note} actions={footer}>
      <BubblesArt />
      <span className={styles.turn}>Practice complete</span>
      <h1 ref={headingRef} tabIndex={-1}>
        Take a moment to reflect.
      </h1>
      <p>You made time to speak, listen, and understand a little more.</p>
      <div className={styles.reflection}>
        <p className={styles.eyebrow}>REFLECT TOGETHER</p>
        <p>{scenario.conclusion.reflectionPrompt ?? DEFAULT_REFLECTION_PROMPT}</p>
        {scenario.conclusion.reflectionFollowUp ? <p>{scenario.conclusion.reflectionFollowUp}</p> : null}
      </div>
    </AppScreen>
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
