import type { Role } from '../sessions/types'
import { ROLE_LABELS } from './roles'
import { Button, Card, StatusMessage } from './ui'
import styles from './screens.module.css'

interface RoleSelectProps {
  busyRole: Role | null
  error: string | null
  onChoose(role: Role): void
}

/** The initial role choice is only a request; the server assigns seats. */
export function RoleSelect({ busyRole, error, onChoose }: RoleSelectProps) {
  return (
    <Card aria-labelledby="role-heading">
      <div className={styles.stack}>
        <h2 id="role-heading" className={styles.heading}>
          Choose your role
        </h2>
        <Button
          block
          loading={busyRole === 'missionary'}
          disabled={busyRole !== null}
          onClick={() => onChoose('missionary')}
        >
          {ROLE_LABELS.missionary}
        </Button>
        <Button
          block
          loading={busyRole === 'christian'}
          disabled={busyRole !== null}
          onClick={() => onChoose('christian')}
        >
          {ROLE_LABELS.christian}
        </Button>
        <StatusMessage tone="error">{error}</StatusMessage>
      </div>
    </Card>
  )
}
