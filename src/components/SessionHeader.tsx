import type { GuidedStage } from '../sessions/types'
import styles from './screens.module.css'

const STAGES: { stage: GuidedStage; label: string }[] = [
  { stage: 'scene_setup', label: 'Scene' },
  { stage: 'interaction_trigger', label: 'Start' },
  { stage: 'opening_dialogue', label: 'Opening' },
  { stage: 'question_selection', label: 'Questions' },
  { stage: 'discussion', label: 'Discussion' },
  { stage: 'conclusion', label: 'Wrap-up' },
]

interface SessionHeaderProps {
  roleLabel: string
  stage: GuidedStage
  onLeave(): void
}

/** Role, shared progress, and the leave control. Progress follows server state only. */
export function SessionHeader({ roleLabel, stage, onLeave }: SessionHeaderProps) {
  const index = Math.max(
    0,
    STAGES.findIndex((item) => item.stage === stage),
  )
  const step = index + 1
  const percent = Math.round((step / STAGES.length) * 100)

  return (
    <div className={styles.sessionHeader}>
      <span className={styles.rolePill}>{roleLabel}</span>
      <div className={styles.progress}>
        <span className={styles.progressLabel}>
          Step {step} of {STAGES.length} · {STAGES[index].label}
        </span>
        <span className={styles.progressTrack} aria-hidden="true">
          <span className={styles.progressFill} style={{ width: `${percent}%` }} />
        </span>
      </div>
      <button type="button" className={styles.leaveButton} aria-label="Leave session" onClick={onLeave}>
        <svg className={styles.leaveIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M14 4h-7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M10 12h10m-3.5-3.5L20 12l-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
