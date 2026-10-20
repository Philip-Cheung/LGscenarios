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

/** One person starts a practice and shares a code; the other joins with it. */
export function Welcome({ notice = null, onCreate, onJoin }: WelcomeProps) {
  return (
    <AppScreen
      meta={<PairingMeta label="Before you begin" />}
      viewKey="welcome"
      note="One person starts the practice. The other joins using a code."
      status={<StatusMessage className={styles.statusLine}>{notice}</StatusMessage>}
      actions={
        <>
          <Button onClick={onCreate}>Start a practice</Button>
          <Button variant="secondary" onClick={onJoin}>
            Join your partner
          </Button>
        </>
      }
    >
      <DoorArt />
      <span className={styles.turn}>
        <Icon />
        Conversation practice for Christians
      </span>
      <h1 tabIndex={-1}>Practice talking with Mormon missionaries.</h1>
      <p>Build confidence in explaining your faith, asking thoughtful questions, and responding with kindness.</p>
      <p>
        Practise with a partner. One person takes the Christian role; the other plays a Latter-day Saint (Mormon)
        missionary.
      </p>
    </AppScreen>
  )
}
