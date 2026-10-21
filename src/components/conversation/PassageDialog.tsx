import { useEffect, useId, useRef } from 'react'
import type { ConversationContent } from '../../lib/conversation'
import type { Role } from '../../sessions/types'
import styles from './conversation.module.css'

const MISSIONARY_CONTEXT = 'Read the complete passage and consider its surrounding verses.'

interface PassageDialogProps {
  content: ConversationContent
  passageId: string
  role: Role
  onClose(): void
}

/**
 * The full supplied passage range for a quotation (KJV unless the passage
 * names another source), on a native modal <dialog>.
 * It can open above the help sheet; closing it returns focus to the
 * quotation or button that opened it, so the sheet and draft stay as they were.
 */
export function PassageDialog({ content, passageId, role, onClose }: PassageDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const passage = content.passages.items.find((item) => item.id === passageId)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.passageDialog}
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.passageInner}>
        <div className={styles.passageHead}>
          <h2 id={titleId}>{passage ? passage.label : 'Passage unavailable'}</h2>
          <button ref={closeRef} type="button" className={styles.quiet} onClick={onClose}>
            Close
          </button>
        </div>
        {passage ? (
          <>
            <p className={styles.passageVersion}>{passage.source ?? content.passages.translation}</p>
            <div className={styles.passageBody} tabIndex={0} aria-label={`${passage.label} text`}>
              {passage.verses.map((verse) => (
                <p key={verse.number} className={styles.verseLine}>
                  <sup className={styles.verseNumber}>{verse.number}</sup> {verse.text}
                </p>
              ))}
              <div className={styles.passageContext}>
                <h3>Reading context</h3>
                <p>{role === 'christian' ? passage.context : MISSIONARY_CONTEXT}</p>
              </div>
            </div>
          </>
        ) : (
          <p className={styles.passageBody} role="alert">
            This passage couldn’t be loaded. No other text has been shown in its place.
          </p>
        )}
      </div>
    </dialog>
  )
}
