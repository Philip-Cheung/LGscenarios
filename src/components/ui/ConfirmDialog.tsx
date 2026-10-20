import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  error?: string | null
  onConfirm(): void
  onCancel(): void
}

/**
 * Accessible confirmation. Focus starts on the safe action, Escape and the
 * backdrop cancel, and focus returns to whatever opened the dialog.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Keep playing',
  destructive = false,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCancelRef = useRef(onCancel)
  const pendingRef = useRef(pending)

  useEffect(() => {
    onCancelRef.current = onCancel
    pendingRef.current = pending
  }, [onCancel, pending])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    cancelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingRef.current) return
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      root?.removeAttribute('inert')
      previouslyFocused?.focus()
    }
  }, [])

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className={styles.title} tabIndex={-1}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.body}>
          {description}
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
