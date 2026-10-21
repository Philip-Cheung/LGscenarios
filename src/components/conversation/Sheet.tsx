import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import styles from './conversation.module.css'

interface SheetProps {
  title: string
  /** Accessible name for the × control, e.g. "Close help". */
  closeLabel: string
  onClose(): void
  /**
   * When true at close, focus goes back to the control that opened the
   * sheet. A choice that fills the draft clears it and focuses Speak aloud.
   */
  restoreFocusRef: RefObject<boolean>
  children: ReactNode
}

/**
 * The bottom sheet for questions, help, and options, on a native modal
 * <dialog>. Only one is open at a time. Escape, the backdrop, and the
 * labelled × close it; a passage dialog may open above it.
 */
export function Sheet({ title, closeLabel, onClose, restoreFocusRef, children }: SheetProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    restoreFocusRef.current = true
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus()
    const onCancel = (event: Event) => {
      event.preventDefault()
      onCloseRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      if (restoreFocusRef.current && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [restoreFocusRef])

  return (
    <dialog
      ref={dialogRef}
      className={styles.sheet}
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.sheetInner}>
        <div className={styles.sheetGrab} aria-hidden="true" />
        <div className={styles.sheetHead}>
          <h2 id={titleId}>{title}</h2>
          <button ref={closeRef} type="button" className={styles.sheetClose} aria-label={closeLabel} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </dialog>
  )
}
