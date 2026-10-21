import { ENDED_COPY, type EndedReason } from './endedCopy'
import { MessageCard } from './MessageCard'

export type { EndedReason }

interface EndedCardProps {
  reason: EndedReason
  onStartOver(): void
}

export function EndedCard({ reason, onStartOver }: EndedCardProps) {
  const { heading, body } = ENDED_COPY[reason]
  return (
    <MessageCard
      heading={heading}
      actionLabel="Start a new practice"
      onAction={onStartOver}
      focusOnMount
      illustrated
    >
      <p>{body}</p>
    </MessageCard>
  )
}
