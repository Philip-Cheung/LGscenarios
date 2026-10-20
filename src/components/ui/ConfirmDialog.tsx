import { useEffect, useId, useRef } from 'react'
import { Button } from './Button'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  pending?: boolean
  error?: string | null
  onConfirm(): void
  onCancel(): void
}

/**
 * Modal confirmation on the native <dialog>. The page behind is inert while it
 * is open, focus starts on the safe action, Escape and the backdrop cancel, and
 * focus returns to whatever opened the dialog.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Keep practising',
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const pendingRef = useRef(pending)

  useEffect(() => {
    onCancelRef.current = onCancel
    pendingRef.current = pending
  }, [onCancel, pending])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    cancelRef.current?.focus()

    const onNativeCancel = (event: Event) => {
      event.preventDefault()
      if (!pendingRef.current) onCancelRef.current()
    }
    dialog.addEventListener('cancel', onNativeCancel)
    return () => {
      dialog.removeEventListener('cancel', onNativeCancel)
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(event) => {
        // Clicks on the backdrop target the dialog element itself.
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        if (!pending) onCancel()
      }}
    >
      <div className={styles.body}>
        <p className={styles.eyebrow}>SESSION CONTROLS</p>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.description}>
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
          <Button loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
