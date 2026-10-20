import { MessageCard } from './MessageCard'
import styles from './screens.module.css'

interface EndedCardProps {
  reason: 'expired' | 'gone'
  onStartOver(): void
}

export function EndedCard({ reason, onStartOver }: EndedCardProps) {
  if (reason === 'expired') {
    return (
      <MessageCard
        heading="This session has ended. Start a new pair."
        actionLabel="Start a new pair"
        onAction={onStartOver}
        focusOnMount
        level="h1"
      />
    )
  }
  return (
    <MessageCard
      heading="This pair is no longer available on this device"
      actionLabel="Start a new pair"
      onAction={onStartOver}
      focusOnMount
      level="h1"
    >
      <p className={styles.muted}>If browser data was cleared or you switched browsers, start a new pair.</p>
    </MessageCard>
  )
}
