import { AppScreen, PairingMeta } from './AppScreen'
import { DoorArt, Icon } from './art'
import { Button, StatusMessage } from './ui'
import styles from './screens.module.css'

interface WelcomeProps {
  /** Explains why the phone is back here, for example after the partner ended the practice. */
  notice?: string | null
  onCreate(): void
  onJoin(): void
}

/** One person creates a practice and shares a code; the other joins with it. */
export function Welcome({ notice = null, onCreate, onJoin }: WelcomeProps) {
  return (
    <AppScreen
      meta={<PairingMeta label="Before you begin" />}
      viewKey="welcome"
      note="One person creates a practice. The other joins with a code."
      status={<StatusMessage className={styles.statusLine}>{notice}</StatusMessage>}
      actions={
        <>
          <Button onClick={onCreate}>Create a practice</Button>
          <Button variant="secondary" onClick={onJoin}>
            Join a practice
          </Button>
        </>
      }
    >
      <DoorArt />
      <h1 tabIndex={-1}>Make room for a conversation.</h1>
      <p>A friendly way to practice speaking, listening, and sharing your perspective.</p>
      <div className={styles.welcomeDetails}>
        <span>
          <Icon />
          Practice with a partner
        </span>
        <span>
          <Icon kind="leaf" />
          Take it one turn at a time
        </span>
      </div>
    </AppScreen>
  )
}
