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

const CONNECTION_TEXT: Record<StripConnection, { dot: string; text: string }> = {
  connected: { dot: '●', text: 'Connected' },
  waiting: { dot: '○', text: 'Not connected yet' },
  reconnecting: { dot: '●', text: 'You’re reconnecting…' },
  partnerAway: { dot: '○', text: 'Reconnecting…' },
}

/** Like a messenger header: the partner's portrait and role, with their connection state beneath. */
export function RoleStrip({ partner, name, connection }: { partner: Role; name: string; connection: StripConnection }) {
  const tone =
    connection === 'reconnecting' || connection === 'partnerAway'
      ? styles.connectionWarning
      : connection === 'waiting'
        ? styles.connectionIdle
        : null
  const { dot, text } = CONNECTION_TEXT[connection]
  return (
    <div className={styles.roleStrip}>
      <Portrait role={partner} />
      <span className={styles.partnerText}>
        <span className={styles.partnerName}>
          <span className={styles.srOnly}>Your partner: </span>
          {name}
        </span>
        <span className={[styles.connection, tone].filter(Boolean).join(' ')} role="status">
          <span aria-hidden="true">{dot} </span>
          {text}
        </span>
      </span>
    </div>
  )
}
