import { useEffect, useRef, useState } from 'react'
import type { ConversationContent } from '../../lib/conversation'
import { prefersReducedMotion } from '../../lib/motion'
import type { EncounterAction, Role, SessionSnapshot } from '../../sessions/types'
import { Button } from '../ui'
import { DoorstepScene, Portrait } from './art'
import styles from './conversation.module.css'

/** The action window the server allows for a knock or an open. */
const WINDOW_MS = 5000
const ROLES: readonly Role[] = ['missionary', 'christian']

interface EncounterScreenProps {
  content: ConversationContent
  snapshot: SessionSnapshot
  /** Server time minus device time. */
  clockOffsetMs: number
  /** Controls are usable: connected, partner present, no request pending. */
  canAct: boolean
  offline: boolean
  busy: boolean
  /** The server refused a late tap; show the retry choices even if this clock disagrees. */
  missed: boolean
  /** The Christian has opened the door; play the opening before the conversation. */
  opening: boolean
  onReady(relaxed: boolean): void
  onAction(action: EncounterAction, relaxed: boolean): void
}

/** Device time, refreshed every 50ms while `active`, for the countdown ring. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 50)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/**
 * Readiness, then the doorstep encounter: the missionary knocks and the
 * Christian opens the door. Each tap has a five second window from the
 * server, unless either player chose relaxed timing. A miss never ends the
 * pair; whoever acts can try again, with or without the timer.
 */
export function EncounterScreen({
  content,
  snapshot,
  clockOffsetMs,
  canAct,
  offline,
  busy,
  missed,
  opening,
  onReady,
  onAction,
}: EncounterScreenProps) {
  const [relaxedChoice, setRelaxedChoice] = useState(false)
  const [knockingUntil, setKnockingUntil] = useState(0)
  const [seenPhase, setSeenPhase] = useState(snapshot.encounterPhase)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { myRole: role, encounterPhase: phase } = snapshot
  const speaker = (who: Role) => content.roles[who].speaker
  const readying = snapshot.stage === 'paired' || snapshot.stage === 'scene_setup'
  const relaxed = relaxedChoice || snapshot.encounterRelaxed
  const now = useNow(!readying && !opening && phase !== null)

  // Both phones play the knock when the server moves from knocking to opening.
  let knockEnds = knockingUntil
  if (seenPhase !== phase) {
    setSeenPhase(phase)
    if (seenPhase === 'knock' && phase === 'open') {
      knockEnds = now + (prefersReducedMotion() ? 450 : 1300)
      setKnockingUntil(knockEnds)
    }
  }
  const knocking = !opening && phase === 'open' && now < knockEnds
  const deadline = snapshot.encounterDeadline ? Date.parse(snapshot.encounterDeadline) : Number.NaN
  const remaining = Number.isNaN(deadline) ? null : deadline - (now + clockOffsetMs)
  const expired = !opening && !knocking && (missed || (remaining !== null && remaining <= 0))
  const knockStep = phase === 'knock' || knocking
  const actor: Role = knockStep ? 'missionary' : 'christian'
  const own = role === actor
  const active = !readying && !opening && !knocking && !expired && phase !== null

  const stepKey = readying ? 'ready' : opening ? 'opening' : `${phase}:${knocking}:${expired}`
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [stepKey])

  if (readying) {
    const bothReady = snapshot.meReady && snapshot.partnerReady
    return (
      <main className={styles.encounter}>
        <div className={styles.introEyebrow}>PAIRED · BEFORE THE CONVERSATION</div>
        <h1 ref={headingRef} tabIndex={-1} className={styles.encounterTitle}>
          Meet at the door
        </h1>
        <p className={styles.introDescription}>Get ready for a short scene before you talk.</p>
        <DoorstepScene phase="closed" />
        <div className={styles.readyPlayers}>
          {ROLES.map((who) => {
            const ready = who === role ? snapshot.meReady : snapshot.partnerReady
            return (
              <div key={who} className={styles.readyPlayer}>
                <Portrait role={who} />
                <span>
                  {speaker(who)}
                  {who === role ? ' (You)' : ''}
                </span>
                <small>{ready ? '✓ Ready' : 'Not ready'}</small>
              </div>
            )
          })}
        </div>
        <label className={styles.timingSetting}>
          <input
            type="checkbox"
            checked={relaxed}
            disabled={snapshot.encounterRelaxed || (snapshot.meReady && role === 'christian')}
            onChange={(event) => setRelaxedChoice(event.target.checked)}
          />
          Relaxed timing — no countdown
        </label>
        <div className={styles.introActions}>
          {!snapshot.meReady ? (
            <Button disabled={!canAct} loading={busy} onClick={() => onReady(relaxed)}>
              I’m ready
            </Button>
          ) : bothReady && role === 'missionary' ? (
            <Button disabled={!canAct} loading={busy} onClick={() => onAction('start', relaxed)}>
              Start encounter
            </Button>
          ) : (
            <p className={styles.fine} role="status">
              {bothReady ? 'Both ready. The LDS Missionary can start.' : 'You’re ready. Waiting for your partner.'}
            </p>
          )}
        </div>
        {offline ? <OfflineNote /> : null}
      </main>
    )
  }

  const title = opening
    ? 'The door opens…'
    : expired
      ? 'Missed it? Try again.'
      : knocking
        ? 'Knock! Knock!'
        : knockStep
          ? own
            ? 'Say “knock knock” and tap'
            : 'Your visitor is at the door'
          : own
            ? 'Open the door'
            : 'Wait for your neighbour'
  const description = expired
    ? 'Your pairing is safe. Restart this action when you’re ready.'
    : active
      ? own
        ? relaxed
          ? 'Tap whenever you’re ready.'
          : 'Tap before the ring runs out.'
        : `${speaker(actor)} controls this action. Watch for their tap.`
      : 'Both players see the same action.'
  const shown = remaining === null ? WINDOW_MS : Math.max(0, Math.min(WINDOW_MS, remaining))

  return (
    <main className={styles.encounter}>
      <div className={styles.introEyebrow}>DOORSTEP ENCOUNTER</div>
      <DoorstepScene phase={opening ? 'opening' : knocking ? 'knocking' : 'closed'} />
      <h1 ref={headingRef} tabIndex={-1} className={styles.encounterTitle}>
        {title}
      </h1>
      <p className={styles.introDescription}>{description}</p>
      {active ? (
        <>
          <div
            className={[styles.timedTarget, own ? '' : styles.observer, relaxed || remaining === null ? styles.relaxed : '']
              .filter(Boolean)
              .join(' ')}
          >
            <svg className={styles.countdownRing} viewBox="0 0 140 140" aria-hidden="true">
              <circle className={styles.timerTrack} cx="70" cy="70" r="63" />
              <circle
                className={styles.timerProgress}
                pathLength="100"
                cx="70"
                cy="70"
                r="63"
                style={{ strokeDashoffset: relaxed || remaining === null ? 0 : 100 - shown / 50 }}
              />
            </svg>
            <button
              type="button"
              className={styles.qteTap}
              disabled={!own || !canAct || busy}
              aria-label={`${knockStep ? 'Knock on the door' : 'Open the door'}${relaxed || remaining === null ? '' : ', five second action'}`}
              onClick={() => onAction(knockStep ? 'knock' : 'open', relaxed)}
            >
              {knockStep ? 'Knock' : 'Open door'}
            </button>
          </div>
          <div className={styles.seconds} role="timer" aria-label={relaxed || remaining === null ? 'No time limit' : 'Seconds remaining'}>
            {relaxed || remaining === null ? 'No time limit' : `${(shown / 1000).toFixed(1)}s`}
          </div>
        </>
      ) : null}
      {expired && own ? (
        <div className={styles.introActions}>
          <Button disabled={!canAct} loading={busy} onClick={() => onAction('retry', false)}>
            Try again
          </Button>
          <Button variant="secondary" disabled={!canAct || busy} onClick={() => onAction('retry', true)}>
            Try without timer
          </Button>
        </div>
      ) : expired ? (
        <p className={styles.fine} role="status">
          Waiting for {speaker(actor)} to retry.
        </p>
      ) : null}
      {offline ? <OfflineNote /> : null}
    </main>
  )
}

function OfflineNote() {
  return (
    <p className={styles.journeyNotice} role="status">
      Connection lost. Your place is saved. Actions are paused until you reconnect.
    </p>
  )
}
