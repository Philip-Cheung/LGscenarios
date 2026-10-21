import styles from './Masthead.module.css'

interface MastheadProps {
  /** The scenario title under the wordmark; omitted when no scenario is known. */
  subtitle?: string
  /** The right-hand control: Back while pairing, Leave once paired. */
  action?: { label: string; onClick(): void; disabled?: boolean } | null
  className?: string
}

/** The compact editorial header: open-door mark, wordmark, scenario title, and one optional control. */
export function Masthead({ subtitle, action, className }: MastheadProps) {
  return (
    <header className={[styles.masthead, className].filter(Boolean).join(' ')}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <DoorMark />
          <div className={styles.text}>
            <span className={styles.wordmark}>Doorstep practice</span>
            {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
          </div>
        </div>
        {action ? (
          <button type="button" className={styles.action} disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
    </header>
  )
}

function DoorMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 36 44" fill="none" aria-hidden="true">
      <path d="M4 39V5a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v34" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="m10 4 16 5v32l-16-4Z" fill="#e1e8dc" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2 40h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="22" cy="23" r="1.2" fill="currentColor" />
    </svg>
  )
}
