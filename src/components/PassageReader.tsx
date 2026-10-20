import { useEffect, useId, useRef, useState } from 'react'
import type { BibleReference, ScenarioBible } from '../lib/content'
import { Button } from './ui'
import styles from './PassageReader.module.css'

export interface PassageReaderProps {
  bible: ScenarioBible | undefined
  referenceId: string
  onClose(): void
}

type Verse = ScenarioBible['chapters'][number]['verses'][number]

interface ResolvedPassage {
  reference: BibleReference
  book: string
  chapter: number
  verses: readonly Verse[]
}

function resolve(bible: ScenarioBible | undefined, referenceId: string): ResolvedPassage | null {
  const reference = bible?.references.find((item) => item.id === referenceId)
  const chapter = reference ? bible?.chapters.find((item) => item.id === reference.chapter) : undefined
  if (!reference || !chapter) return null
  return { reference, book: chapter.book, chapter: chapter.chapter, verses: chapter.verses }
}

function versesBetween(verses: readonly Verse[], start: number, end: number): Verse[] {
  return verses.filter((verse) => verse.number >= start && verse.number <= end)
}

/**
 * A private Bible passage on the native <dialog>: a bottom sheet on phones and
 * a centred dialog on wider screens. The page behind is inert, Escape and the
 * backdrop close it, and focus returns to the reference that opened it.
 */
export function PassageReader({ bible, referenceId, onClose }: PassageReaderProps) {
  const titleId = useId()
  const versesId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const [expanded, setExpanded] = useState(false)
  const passage = resolve(bible, referenceId)

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

    const onNativeCancel = (event: Event) => {
      event.preventDefault()
      onCloseRef.current()
    }
    dialog.addEventListener('cancel', onNativeCancel)
    return () => {
      dialog.removeEventListener('cancel', onNativeCancel)
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  // Expanding keeps the selected verses in view rather than jumping to the top of the context.
  useEffect(() => {
    const scroller = bodyRef.current
    if (!scroller) return
    const first = expanded ? scroller.querySelector(`.${styles.selected}`) : null
    scroller.scrollTop = first instanceof HTMLElement ? Math.max(0, first.offsetTop - scroller.offsetTop - 12) : 0
  }, [expanded])

  const { reference } = passage ?? {}
  const context = reference?.context
  const range = expanded && context ? context : reference
  const shown = passage && range ? versesBetween(passage.verses, range.start, range.end) : []
  const isSelected = (verse: Verse) => !!reference && verse.number >= reference.start && verse.number <= reference.end

  return (
    <dialog
      ref={dialogRef}
      className={styles.reader}
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        // Clicks on the backdrop target the dialog element itself.
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {passage ? passage.reference.label : 'Passage unavailable'}
          </h2>
          {passage && bible ? <p className={styles.translation}>{bible.translation}</p> : null}
        </header>
        <div ref={bodyRef} className={styles.body} tabIndex={0} aria-label={passage ? `${passage.reference.label} text` : undefined}>
          {passage ? (
            <>
              {expanded && context ? (
                <p className={styles.range}>
                  Showing {passage.book} {passage.chapter}:{context.start}–{context.end}. The selected verses are highlighted.
                </p>
              ) : null}
              <div id={versesId} className={styles.verses}>
                {shown.map((verse) => {
                  const highlighted = expanded && isSelected(verse)
                  return (
                    <p key={verse.number} className={highlighted ? `${styles.verse} ${styles.selected}` : styles.verse}>
                      {highlighted ? <span className={styles.srOnly}>Selected verse </span> : null}
                      <span className={styles.number}>{verse.number}</span> {verse.text}
                    </p>
                  )
                })}
              </div>
            </>
          ) : (
            <p className={styles.failure} role="alert">
              This passage couldn’t be loaded. No other text has been shown in its place.
            </p>
          )}
        </div>
        <footer className={styles.footer}>
          {context ? (
            <Button
              variant="secondary"
              aria-expanded={expanded}
              aria-controls={versesId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Show selected verses' : 'Read surrounding verses'}
            </Button>
          ) : null}
          <Button ref={closeRef} onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </dialog>
  )
}
