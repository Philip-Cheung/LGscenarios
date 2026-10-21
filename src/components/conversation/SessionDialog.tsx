import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './conversation.module.css'

interface SessionDialogProps {
  title: string
  description: string
  /** Escape and the backdrop call this; it must be the safe choice (keep, cancel, or decline). */
  onDismiss(): void
  /** While a request is in flight the dialog cannot be dismissed. */
  busy?: boolean
  error?: string | null
  children: ReactNode
}

/**
 * Leave, restart, and swap confirmations and requests, on a native modal
 * <dialog>. Focus starts on the first action, which is always the safe one,
 * and returns to the opener when the dialog closes.
 */
export function SessionDialog({ title, description, onDismiss, busy = false, error = null, children }: SessionDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dismissRef = useRef(onDismiss)
  const busyRef = useRef(busy)

  useEffect(() => {
    dismissRef.current = onDismiss
    busyRef.current = busy
  }, [onDismiss, busy])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.querySelector<HTMLButtonElement>('button')?.focus()
    const onCancel = (event: Event) => {
      event.preventDefault()
      if (!busyRef.current) dismissRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.sessionDialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onDismiss()
      }}
    >
      <div className={styles.sessionDialogInner}>
        <h2 id={titleId} className={styles.sessionDialogHeading}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.sessionDialogCopy}>
          {description}
        </p>
        {error ? (
          <p className={styles.pairError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>{children}</div>
      </div>
    </dialog>
  )
}
