import { useState } from 'react'
import type { ScenarioContent } from '../lib/content'
import type { Role } from '../sessions/types'
import { AppScreen, PairingMeta } from './AppScreen'
import { Icon } from './art'
import { ROLE_CAPTIONS } from './roles'
import { Button, StatusMessage } from './ui'
import styles from './screens.module.css'

interface RoleSelectProps {
  scenario: ScenarioContent
  initialRole?: Role
  busy: boolean
  error: string | null
  onCreate(role: Role): void
  onBack(): void
}

const ROLES: readonly Role[] = ['missionary', 'christian']

/**
 * The person creating the practice chooses their role; whoever joins with the
 * code takes the other one. The server assigns the seats.
 */
export function RoleSelect({ scenario, initialRole = 'missionary', busy, error, onCreate, onBack }: RoleSelectProps) {
  const [role, setRole] = useState<Role>(initialRole)

  return (
    <AppScreen
      meta={<PairingMeta label="Before you begin" />}
      viewKey="roles"
      status={
        <StatusMessage tone="error" className={styles.statusLine}>
          {error}
        </StatusMessage>
      }
      actions={
        <>
          <Button loading={busy} onClick={() => onCreate(role)}>
            Get a pairing code
          </Button>
          <Button variant="text" disabled={busy} onClick={onBack}>
            Back
          </Button>
        </>
      }
    >
      <span className={styles.turn}>
        <Icon />
        Start a practice
      </span>
      <h1 tabIndex={-1}>Which role will you practise?</h1>
      <p>One person practises as the Christian. The other plays the missionary to help their partner prepare.</p>
      <fieldset className={styles.choices} disabled={busy}>
        <legend className={styles.srOnly}>Your practice role</legend>
        {ROLES.map((value) => (
          <label key={value} className={styles.choice}>
            <span>
              <small>{ROLE_CAPTIONS[value]}</small>
              <strong>{scenario.roles[value].label}</strong>
            </span>
            <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
          </label>
        ))}
      </fieldset>
      <div className={styles.goal}>
        <Icon kind="goal" />
        <div>
          <small>YOUR CONVERSATION</small>
          <p>{scenario.title}</p>
        </div>
      </div>
    </AppScreen>
  )
}
