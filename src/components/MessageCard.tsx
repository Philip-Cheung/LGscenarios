import { useEffect, useRef, type ReactNode } from 'react'
import { Button, Card } from './ui'
import styles from './screens.module.css'

interface MessageCardProps {
  heading: string
  children?: ReactNode
  actionLabel?: string
  onAction?(): void
  /** Move focus to the heading when this card replaces another screen. */
  focusOnMount?: boolean
  level?: 'h1' | 'h2'
}

export function MessageCard({
  heading,
  children,
  actionLabel,
  onAction,
  focusOnMount = false,
  level = 'h2',
}: MessageCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])
  const Heading = level

  return (
    <Card aria-labelledby="message-heading">
      <div className={styles.stack}>
        <Heading id="message-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
          {heading}
        </Heading>
        {children}
        {actionLabel && onAction ? (
          <Button block onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
