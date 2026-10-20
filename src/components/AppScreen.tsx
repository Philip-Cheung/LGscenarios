import { useEffect, useRef, useState, type ReactNode } from 'react'
import { readMotionPaused, setMotionPaused } from '../lib/motion'
import type { GuidedStage } from '../sessions/types'
import styles from './screens.module.css'

/** The parts of the panel that stay the same while the content changes. */
export interface ScreenFrame {
  /** Session controls in the header; omitted before pairing. */
  menu?: ReactNode
  /** Pairing label or practice progress under the header. */
  meta: ReactNode
  /** Live status line (connection, errors) above the actions. */
  status?: ReactNode
}

interface AppScreenProps extends ScreenFrame {
  /** Changing this replays the entrance motion and resets the content's local state. */
  viewKey: string
  /** Centred layout for waiting, paired, paused, and completion screens. */
  waiting?: boolean
  note?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** The product panel from the reference: header, meta, content, note, actions. */
export function AppScreen({ menu, meta, status, viewKey, waiting = false, note, actions, children }: AppScreenProps) {
  return (
    <article className={styles.appScreen}>
      <header className={styles.appTop}>
        <span className={styles.wordmark}>Doorstep practice</span>
        {menu}
      </header>
      {meta}
      <div key={viewKey} className={[styles.content, waiting ? styles.waiting : null].filter(Boolean).join(' ')}>
        {children}
      </div>
      {note ? <p className={styles.statusNote}>{note}</p> : null}
      {status}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </article>
  )
}

export function PairingMeta({ label }: { label: string }) {
  return (
    <div className={styles.pairingMeta}>
      <span>{label}</span>
      <span>Speak · Listen · Connect</span>
    </div>
  )
}

const PRACTICE_STEPS: readonly { stage: GuidedStage; name: string }[] = [
  { stage: 'scene_setup', name: 'Scene' },
  { stage: 'ready_together', name: 'Ready together' },
  { stage: 'opening_dialogue', name: 'Opening' },
  { stage: 'question_selection', name: 'Questions' },
  { stage: 'response', name: 'Response' },
  { stage: 'closing', name: 'Closing' },
]

/** "Practising: Christian · 2 of 6 · Ready together" with six segments. */
export function ProgressMeta({ roleLabel, stage }: { roleLabel: string; stage: GuidedStage }) {
  const complete = stage === 'conclusion'
  const index = PRACTICE_STEPS.findIndex((step) => step.stage === stage)
  const step = complete ? PRACTICE_STEPS.length : index + 1
  const name = complete ? 'Complete' : (PRACTICE_STEPS[index]?.name ?? '')
  return (
    <>
      <div className={styles.sessionMeta}>
        <span>
          Practising: <b>{roleLabel}</b>
        </span>
        <span>{complete ? 'Complete' : `${step} of ${PRACTICE_STEPS.length} · ${name}`}</span>
      </div>
      <div
        className={styles.segments}
        role="progressbar"
        aria-label="Practice progress"
        aria-valuemin={0}
        aria-valuemax={PRACTICE_STEPS.length}
        aria-valuenow={step}
        aria-valuetext={name}
      >
        {PRACTICE_STEPS.map((item, i) => (
          <span key={item.stage} className={[styles.segment, i < step ? styles.segmentActive : null].filter(Boolean).join(' ')} />
        ))}
      </div>
    </>
  )
}

interface SessionMenuProps {
  /** Omitted when restarting is not available to this participant right now. */
  onRestart?: () => void
  onLeave(): void
}

/** The "···" session controls: restart, motion preference, and leave. */
export function SessionMenu({ onRestart, onLeave }: SessionMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [motionPaused, setPausedState] = useState(readMotionPaused)

  useEffect(() => {
    if (!open) return
    const close = (returnFocus: boolean) => {
      if (detailsRef.current) detailsRef.current.open = false
      if (returnFocus) summaryRef.current?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (action: () => void) => {
    if (detailsRef.current) detailsRef.current.open = false
    summaryRef.current?.focus()
    action()
  }

  return (
    <details ref={detailsRef} className={styles.sessionMenu} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary ref={summaryRef} aria-label="Session controls">
        ···
      </summary>
      <div className={styles.menuItems}>
        {onRestart ? (
          <button type="button" onClick={() => choose(onRestart)}>
            Restart practice
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            const next = !motionPaused
            setMotionPaused(next)
            setPausedState(next)
          }}
        >
          {motionPaused ? 'Resume motion' : 'Pause motion'}
        </button>
        <button type="button" className={styles.danger} onClick={() => choose(onLeave)}>
          Leave session
        </button>
      </div>
    </details>
  )
}
