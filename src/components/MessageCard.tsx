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
}

export function MessageCard({ heading, children, actionLabel, onAction, focusOnMount = false }: MessageCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])

  return (
    <Card aria-labelledby="message-heading">
      <div className={styles.stack}>
        <h2 id="message-heading" ref={headingRef} tabIndex={-1} className={styles.heading}>
          {heading}
        </h2>
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
