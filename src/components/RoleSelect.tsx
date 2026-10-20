import type { Role } from '../sessions/types'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from './roles'
import { StatusMessage } from './ui'
import styles from './screens.module.css'

interface RoleSelectProps {
  busyRole: Role | null
  error: string | null
  notice?: string | null
  onChoose(role: Role): void
}

/** The initial role choice is only a request; the server assigns seats. */
export function RoleSelect({ busyRole, error, notice = null, onChoose }: RoleSelectProps) {
  return (
    <section className={styles.roleSection} aria-labelledby="role-heading">
      <h2 id="role-heading" className={styles.heading}>
        Choose your role
      </h2>
      <div className={styles.choices}>
        <RoleCard role="missionary" busyRole={busyRole} onChoose={onChoose} />
        <RoleCard role="christian" busyRole={busyRole} onChoose={onChoose} />
      </div>
      <StatusMessage>{notice}</StatusMessage>
      <StatusMessage tone="error">{error}</StatusMessage>
    </section>
  )
}

function RoleCard({
  role,
  busyRole,
  onChoose,
}: {
  role: Role
  busyRole: Role | null
  onChoose(role: Role): void
}) {
  const busy = busyRole === role
  return (
    <button
      type="button"
      className={styles.choice}
      disabled={busyRole !== null}
      aria-busy={busy || undefined}
      onClick={() => onChoose(role)}
    >
      <span className={styles.choiceTitle}>{ROLE_LABELS[role]}</span>
      <span className={styles.choiceBody}>{ROLE_DESCRIPTIONS[role]}</span>
    </button>
  )
}
