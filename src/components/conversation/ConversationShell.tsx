import type { ReactNode } from 'react'
import type { Role } from '../../sessions/types'
import { Masthead } from '../Masthead'
import { Portrait } from './art'
import styles from './conversation.module.css'

interface ConversationShellProps {
  /** The scenario title under the wordmark. */
  subtitle: string
  /** The header control: Back while pairing, Leave once paired. */
  action?: { label: string; onClick(): void; disabled?: boolean } | null
  strip?: ReactNode
  /** Grid row sizing: the conversation pins its composer below a scrolling thread. */
  layout?: 'screen' | 'conversation'
  children: ReactNode
}

/** The edge-to-edge app frame from the prototype: header, optional role strip, then the screen. */
export function ConversationShell({ subtitle, action, strip, layout = 'screen', children }: ConversationShellProps) {
  return (
    <div className={[styles.app, layout === 'conversation' ? styles.appConversation : ''].filter(Boolean).join(' ')}>
      <Masthead subtitle={subtitle} action={action} className={styles.header} />
      {strip}
      {children}
    </div>
  )
}

export type StripConnection = 'connected' | 'waiting' | 'reconnecting' | 'partnerAway'

const CONNECTION_TEXT: Record<StripConnection, string> = {
  connected: '● Partner connected',
  waiting: '○ Waiting for partner',
  reconnecting: '● Reconnecting…',
  partnerAway: '○ Partner reconnecting…',
}

/** "Missionary (You)" with a portrait, and the connection state. */
export function RoleStrip({ role, speaker, connection }: { role: Role; speaker: string; connection: StripConnection }) {
  const warning = connection === 'reconnecting' || connection === 'partnerAway'
  return (
    <div className={styles.roleStrip}>
      <span className={styles.roleLabel}>
        <Portrait role={role} />
        <span>{speaker} (You)</span>
      </span>
      <span className={warning ? `${styles.connection} ${styles.connectionWarning}` : styles.connection} role="status">
        {CONNECTION_TEXT[connection]}
      </span>
    </div>
  )
}
