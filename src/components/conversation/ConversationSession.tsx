import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConversationContent } from '../../lib/conversation'
import { prefersReducedMotion } from '../../lib/motion'
import { messageForEndFailure } from '../../sessions/messages'
import { isPartnerAway, isRequestCurrent } from '../../sessions/snapshot'
import type { SessionErrorCode, SessionSnapshot } from '../../sessions/types'
import type { ConnectionState, PendingAction, SessionActions } from '../../sessions/useSessionSync'
import { Button } from '../ui'
import { useDelayedFlag } from '../useDelayedFlag'
import { CompletionScreen } from './CompletionScreen'
import styles from './conversation.module.css'
import { ConversationShell, RoleStrip, type StripConnection } from './ConversationShell'
import { OpenPassageContext } from './passageContext'
import { ConversationView, type SessionRequestKind } from './ConversationView'
import { EncounterScreen } from './EncounterScreen'
import { InvitePartner } from './PairingScreens'
import { PassageDialog } from './PassageDialog'
import { SessionDialog } from './SessionDialog'

const CONNECTION_MESSAGE_DELAY_MS = 800

interface ConversationSessionProps {
  content: ConversationContent
  snapshot: SessionSnapshot
  connection: ConnectionState
  pending: PendingAction | null
  notice: string | null
  lastError: SessionErrorCode | null
  actions: SessionActions
  clockOffsetMs: number
  /** True when this browser reopened a pair it was already seated in. */
  resumed: boolean
}

type Request = { kind: SessionRequestKind; byMe: boolean; requestedAt: string | null }
type Confirm = 'leave' | SessionRequestKind
type OpeningStep = 'door' | 'fade' | null

/** A full-screen message inside the app frame: an ended or expired session, or a stale version. */
export function ConversationNotice({
  subtitle,
  heading,
  body,
  actionLabel,
  onAction,
}: {
  subtitle: string
  heading: string
  body: string
  actionLabel: string
  onAction(): void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <ConversationShell subtitle={subtitle}>
      <main className={styles.journey}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.journeyTitle}>
          {heading}
        </h1>
        <p className={styles.journeyDescription}>{body}</p>
        <div className={styles.journeyActions}>
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      </main>
    </ConversationShell>
  )
}

/** Re-renders when a pending request reaches its 60 second limit. */
function useRequestLive(pending: boolean, requestedAt: string | null, allowUntimed: boolean): boolean {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!pending || !requestedAt) return
    const at = Date.parse(requestedAt)
    if (Number.isNaN(at)) return
    const remaining = at + 60_000 - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setTick((value) => value + 1), remaining)
    return () => window.clearTimeout(timer)
  }, [pending, requestedAt])
  if (!pending) return false
  return requestedAt === null ? allowUntimed : isRequestCurrent(requestedAt)
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

interface Seen {
  round: number
  stage: SessionSnapshot['stage']
  status: SessionSnapshot['status']
  historyLength: number
  request: Request | null
}

/**
 * One participant's conversation session, from the pairing code to
 * reflection. Every shared step comes from the server snapshot; this only
 * adds the local moments between them (the door opening, the goodbye) when
 * they are seen live, and never on a reload.
 */
export function ConversationSession({
  content,
  snapshot,
  connection,
  pending,
  notice,
  lastError,
  actions,
  clockOffsetMs,
  resumed,
}: ConversationSessionProps) {
  const offline = useDelayedFlag(connection !== 'live', CONNECTION_MESSAGE_DELAY_MS)
  const partnerAway = snapshot.status !== 'waiting' && isPartnerAway(snapshot)
  const restartLive = useRequestLive(snapshot.restartPending, snapshot.restartRequestedAt, false)
  const swapLive = useRequestLive(snapshot.swapPending, snapshot.swapRequestedAt, true)
  const request: Request | null = restartLive
    ? {
        kind: snapshot.restartHardMode ? 'hardMode' : 'restart',
        byMe: snapshot.restartByMe,
        requestedAt: snapshot.restartRequestedAt,
      }
    : swapLive
      ? { kind: 'swap', byMe: snapshot.swapByMe, requestedAt: snapshot.swapRequestedAt }
      : null
  const codeExpired = useHasPassed(snapshot.codeExpiresAt ?? null) || !snapshot.pairCode
  const live = connection === 'live'
  const canAct = live && pending === null && !partnerAway && request === null

  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [leaveFailed, setLeaveFailed] = useState(false)
  const [leaveOffline, setLeaveOffline] = useState(false)
  const [passageId, setPassageId] = useState<string | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [opening, setOpening] = useState<OpeningStep>(null)
  const [outroRound, setOutroRound] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [seen, setSeen] = useState<Seen>({
    round: snapshot.round,
    stage: snapshot.stage,
    status: snapshot.status,
    historyLength: snapshot.history.length,
    request,
  })

  // Shared transitions seen while this screen is open.
  const requestChanged = seen.request?.kind !== request?.kind || seen.request?.byMe !== request?.byMe
  if (
    seen.round !== snapshot.round ||
    seen.stage !== snapshot.stage ||
    seen.status !== snapshot.status ||
    seen.historyLength !== snapshot.history.length ||
    requestChanged
  ) {
    const sameRound = seen.round === snapshot.round
    setSeen({
      round: snapshot.round,
      stage: snapshot.stage,
      status: snapshot.status,
      historyLength: snapshot.history.length,
      request,
    })
    if (sameRound && seen.stage === 'encounter' && snapshot.stage === 'conversation') setOpening('door')
    if (sameRound && seen.status === 'active' && snapshot.status === 'completed') setOutroRound(snapshot.round)
    let next: string | null = sessionNotice
    if (seen.stage !== snapshot.stage || seen.historyLength !== snapshot.history.length) next = null
    if (seen.request && !request) {
      if (!sameRound) {
        next = seen.request.kind === 'swap' ? 'Roles switched. Get ready for a new round.' : 'New round. Your roles are unchanged.'
      } else if (answered) {
        next = null
      } else if (!isRequestCurrent(seen.request.requestedAt) && seen.request.requestedAt !== null) {
        next = 'The request expired. You can ask again.'
      } else if (seen.request.byMe) {
        next = 'Your partner declined. Continue where you left off.'
      }
      setAnswered(false)
      setConfirm(null)
    }
    if (next !== sessionNotice) setSessionNotice(next)
  }

  useEffect(() => {
    if (!opening) return
    const reduced = prefersReducedMotion()
    const timer = window.setTimeout(
      () => setOpening(opening === 'door' ? 'fade' : null),
      opening === 'door' ? (reduced ? 450 : 1300) : reduced ? 80 : 480,
    )
    return () => window.clearTimeout(timer)
  }, [opening])

  const partnerRole = snapshot.myRole === 'missionary' ? 'christian' : 'missionary'
  const waiting = snapshot.status === 'waiting'
  const stripConnection: StripConnection =
    connection !== 'live' && offline
      ? 'reconnecting'
      : waiting
        ? 'waiting'
        : partnerAway
          ? 'partnerAway'
          : 'connected'

  const openLeave = () => {
    setLeaveFailed(false)
    setLeaveOffline(false)
    setConfirm('leave')
  }

  const confirmLeave = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setLeaveOffline(true)
      setLeaveFailed(true)
      return
    }
    setLeaveOffline(false)
    const ok = await actions.end()
    if (!ok) setLeaveFailed(true)
  }

  const requestRound = async (kind: SessionRequestKind) => {
    const ok =
      kind === 'swap'
        ? await actions.requestSwap()
        : kind === 'hardMode'
          ? await actions.requestHardMode()
          : await actions.requestRestart()
    if (ok) setConfirm(null)
  }

  const answer = (accept: boolean) => {
    if (!request) return
    setAnswered(true)
    if (request.kind === 'swap') void (accept ? actions.acceptSwap() : actions.declineSwap())
    else void (accept ? actions.acceptRestart() : actions.declineRestart())
  }

  const cancelRequest = () => {
    if (!request) return
    setAnswered(true)
    void (request.kind === 'swap' ? actions.cancelSwap() : actions.cancelRestart())
  }

  const inConversation = snapshot.stage === 'conversation' && snapshot.status === 'active' && opening === null
  const showsDialog = confirm !== null || request !== null

  const banner = offline
    ? 'Your place and conversation are saved. Actions and the encounter timer are paused until you reconnect.'
    : partnerAway
      ? 'Your partner’s connection dropped. Your place is saved; you can continue when they’re back.'
      : (notice ?? sessionNotice)
  const strip = (
    <>
      <RoleStrip partner={partnerRole} name={content.roles[partnerRole].speaker} connection={stripConnection} />
      {banner ? (
        <p className={styles.sessionBanner} role="status">
          {banner}
        </p>
      ) : null}
    </>
  )

  let body: ReactNode
  if (waiting) {
    body = (
      <InvitePartner
        content={content}
        role={snapshot.myRole}
        pairCode={snapshot.pairCode ?? null}
        codeExpired={codeExpired}
        resumed={resumed}
        canAct={live && pending === null}
        regenerating={pending === 'regenerate'}
        closing={pending === 'end'}
        closeError={leaveFailed && confirm === null ? messageForEndFailure(leaveOffline, leaveOffline ? null : lastError) : null}
        onRegenerate={() => void actions.regenerateCode()}
        onChangeRoles={() => void confirmLeave()}
      />
    )
  } else if (snapshot.status === 'completed') {
    body = (
      <CompletionScreen
        key={snapshot.round}
        content={content}
        snapshot={snapshot}
        playOutro={outroRound === snapshot.round}
        paused={showsDialog || offline || passageId !== null}
        canAct={canAct}
        onSessionRequest={(kind) => setConfirm(kind)}
        onLeave={openLeave}
      />
    )
  } else if (inConversation) {
    body = (
      <ConversationView
        key={`${snapshot.round}:${snapshot.myRole}`}
        content={content}
        snapshot={snapshot}
        canAct={canAct}
        interrupted={request !== null || offline || partnerAway}
        sending={pending === 'commit'}
        status={strip}
        onCommit={(itemId) => void actions.commit(itemId)}
        onSessionRequest={(kind) => setConfirm(kind)}
      />
    )
  } else {
    body = (
      <EncounterScreen
        key={`${snapshot.round}:${snapshot.myRole}`}
        content={content}
        snapshot={snapshot}
        clockOffsetMs={clockOffsetMs}
        canAct={canAct}
        offline={offline}
        busy={pending === 'setReady' || pending === 'encounter'}
        missed={lastError === 'deadline_passed'}
        opening={opening !== null}
        onReady={(relaxed) => void actions.setReady(relaxed)}
        onAction={(action, relaxed) => void actions.encounter(action, relaxed)}
      />
    )
  }

  return (
    <OpenPassageContext.Provider value={setPassageId}>
      <ConversationShell
        subtitle={content.title}
        layout={inConversation ? 'conversation' : 'screen'}
        action={{ label: waiting ? 'Back' : 'Leave', onClick: openLeave, disabled: pending === 'end' }}
        strip={inConversation ? null : strip}
      >
        {body}
        <div className={opening === 'fade' ? `${styles.screenFade} ${styles.black}` : styles.screenFade} aria-hidden="true" />
      </ConversationShell>

      {passageId ? (
        <PassageDialog content={content} passageId={passageId} role={snapshot.myRole} onClose={() => setPassageId(null)} />
      ) : null}

      {request ? (
        request.byMe ? (
          <SessionDialog
            title="Waiting for your partner"
            description={
              request.kind === 'swap'
                ? 'You asked to switch roles. Your current round is paused.'
                : request.kind === 'hardMode'
                  ? 'You asked to try Hard mode. Your current round is paused.'
                  : 'You asked to play again. Your current round is paused.'
            }
            busy={pending !== null}
            error={pending === null ? notice : null}
            onDismiss={cancelRequest}
          >
            <Button variant="secondary" disabled={!live || pending !== null} loading={pending === 'cancelSwap' || pending === 'cancelRestart'} onClick={cancelRequest}>
              Cancel request
            </Button>
          </SessionDialog>
        ) : (
          <SessionDialog
            title={
              request.kind === 'swap'
                ? 'Your partner wants to switch roles'
                : request.kind === 'hardMode'
                  ? 'Your partner wants to try Hard mode'
                  : 'Your partner wants to play again'
            }
            description={
              request.kind === 'swap'
                ? `Accept to clear this round and start at Ready as the ${snapshot.myRole === 'missionary' ? 'Christian' : 'LDS Missionary'}.`
                : request.kind === 'hardMode'
                  ? 'Accept to start Hard mode at Ready with the same roles. This time the LDS Missionary responds to what the Christian says.'
                  : 'Accept to clear this conversation and start at Ready with the same roles.'
            }
            busy={pending !== null}
            error={pending === null ? notice : null}
            onDismiss={() => answer(false)}
          >
            <Button variant="secondary" disabled={!live || pending !== null} loading={pending === 'declineSwap' || pending === 'declineRestart'} onClick={() => answer(false)}>
              Decline
            </Button>
            <Button disabled={!live || pending !== null} loading={pending === 'acceptSwap' || pending === 'acceptRestart'} onClick={() => answer(true)}>
              {request.kind === 'swap' ? 'Accept and switch' : request.kind === 'hardMode' ? 'Accept and start' : 'Accept and restart'}
            </Button>
          </SessionDialog>
        )
      ) : confirm === 'leave' ? (
        <SessionDialog
          title="End this session?"
          description={
            waiting
              ? 'This closes your pairing code and returns you to role selection.'
              : 'This ends the session for both players and returns you to role selection.'
          }
          busy={pending === 'end'}
          error={leaveFailed ? messageForEndFailure(leaveOffline, leaveOffline ? null : lastError) : null}
          onDismiss={() => setConfirm(null)}
        >
          <Button variant="secondary" disabled={pending === 'end'} onClick={() => setConfirm(null)}>
            Keep playing
          </Button>
          <Button loading={pending === 'end'} onClick={() => void confirmLeave()}>
            End session
          </Button>
        </SessionDialog>
      ) : confirm ? (
        <SessionDialog
          title={confirm === 'swap' ? 'Switch roles?' : confirm === 'hardMode' ? 'Try Hard mode?' : 'Start another round?'}
          description={
            confirm === 'swap'
              ? 'Your partner will be asked to agree. A new round starts with your roles reversed.'
              : confirm === 'hardMode'
                ? 'Your partner will be asked to agree. You both move to Hard mode and return to Ready with the same roles.'
                : 'Your partner will be asked to agree. The conversation clears and both players return to Ready with the same roles.'
          }
          busy={pending === 'requestSwap' || pending === 'requestRestart' || pending === 'requestHardMode'}
          error={pending === null ? notice : null}
          onDismiss={() => setConfirm(null)}
        >
          <Button variant="secondary" disabled={pending !== null} onClick={() => setConfirm(null)}>
            Keep this round
          </Button>
          <Button
            disabled={!canAct && pending === null}
            loading={pending === 'requestSwap' || pending === 'requestRestart' || pending === 'requestHardMode'}
            onClick={() => void requestRound(confirm)}
          >
            {confirm === 'swap' ? 'Ask to switch' : confirm === 'hardMode' ? 'Ask to start' : 'Ask to restart'}
          </Button>
        </SessionDialog>
      ) : null}
    </OpenPassageContext.Provider>
  )
}
