import { useEffect, useRef, useState } from 'react'
import { loadTurnstile } from '../lib/turnstile'
import { Button, Card, StatusMessage } from './ui'
import styles from './screens.module.css'

interface HumanCheckProps {
  siteKey: string
  onToken(token: string): void
  onCancel(): void
}

/** Cloudflare Turnstile, shown only when a new anonymous identity is needed. */
export function HumanCheck({ siteKey, onToken, onCancel }: HumanCheckProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const onTokenRef = useRef(onToken)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          appearance: 'interaction-only',
          callback: (token) => onTokenRef.current(token),
          'error-callback': () => setError('The check could not be completed. Go back and choose your role again.'),
          'expired-callback': () => setError('The check expired. Go back and choose your role again.'),
        })
      })
      .catch(() => {
        if (!cancelled) setError('The check could not load. Check your connection, then go back and try again.')
      })
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  return (
    <Card aria-labelledby="check-heading">
      <div className={styles.stack}>
        <h2 id="check-heading" className={styles.heading}>
          Just a moment
        </h2>
        <p className={styles.muted}>Checking this browser before pairing.</p>
        <div ref={containerRef} className={styles.captcha} />
        <StatusMessage tone="error">{error}</StatusMessage>
        <Button variant="secondary" block onClick={onCancel}>
          Back
        </Button>
      </div>
    </Card>
  )
}
