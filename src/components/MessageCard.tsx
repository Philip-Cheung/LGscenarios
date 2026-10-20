import { useEffect, useRef, type ReactNode } from 'react'
import { AppScreen, PairingMeta } from './AppScreen'
import { BubblesArt } from './art'
import { Button } from './ui'

interface MessageCardProps {
  heading: string
  children?: ReactNode
  actionLabel?: string
  onAction?(): void
  /** Move focus to the heading when this screen replaces another one. */
  focusOnMount?: boolean
  /** Label under the header, e.g. "Session ended". */
  metaLabel?: string
  /** Centred layout with the speech-bubble illustration. */
  illustrated?: boolean
}

/** A full panel with one message and an optional action. */
export function MessageCard({
  heading,
  children,
  actionLabel,
  onAction,
  focusOnMount = false,
  metaLabel = 'Before you begin',
  illustrated = false,
}: MessageCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])

  return (
    <AppScreen
      meta={<PairingMeta label={metaLabel} />}
      viewKey={heading}
      waiting={illustrated}
      actions={
        actionLabel && onAction ? (
          <Button onClick={onAction}>{actionLabel}</Button>
        ) : undefined
      }
    >
      {illustrated ? <BubblesArt /> : null}
      <h1 ref={headingRef} tabIndex={-1}>
        {heading}
      </h1>
      {children}
    </AppScreen>
  )
}

export function LoadingCard() {
  return (
    <AppScreen meta={<PairingMeta label="Before you begin" />} viewKey="loading">
      <p role="status">Loading…</p>
    </AppScreen>
  )
}
