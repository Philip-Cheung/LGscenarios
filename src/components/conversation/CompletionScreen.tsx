import { useEffect, useId, useRef, useState } from 'react'
import type { ConversationContent } from '../../lib/conversation'
import { prefersReducedMotion } from '../../lib/motion'
import type { SessionSnapshot } from '../../sessions/types'
import { Button } from '../ui'
import { OutroScene } from './art'
import styles from './conversation.module.css'
import { Message, type SessionRequestKind } from './ConversationView'
import { threadMessages } from './model'

const OUTRO_MS = 5200
const REDUCED_OUTRO_MS = 1200

interface CompletionScreenProps {
  content: ConversationContent
  snapshot: SessionSnapshot
  /** The closing line was just spoken on this screen; play the goodbye first. */
  playOutro: boolean
  /** A dialog or a lost connection holds the goodbye where it is. */
  paused: boolean
  canAct: boolean
  onSessionRequest(kind: SessionRequestKind): void
  onLeave(): void
}

/**
 * After the closing line: a short goodbye at the doorstep, then reflection
 * with the next-round choices. Reopening a finished session goes straight to
 * reflection.
 */
export function CompletionScreen({ content, snapshot, playOutro, paused, canAct, onSessionRequest, onLeave }: CompletionScreenProps) {
  const [outroDone, setOutroDone] = useState(!playOutro)
  const elapsed = useRef(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const hardModeNoteId = useId()

  useEffect(() => {
    if (outroDone || paused) return
    const duration = prefersReducedMotion() ? REDUCED_OUTRO_MS : OUTRO_MS
    const started = performance.now()
    const timer = window.setTimeout(() => setOutroDone(true), Math.max(0, duration - elapsed.current))
    return () => {
      window.clearTimeout(timer)
      elapsed.current += performance.now() - started
    }
  }, [outroDone, paused])

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [outroDone])

  if (!outroDone) {
    return (
      <main className={styles.journey}>
        <div className={styles.journeyKicker}>CONVERSATION COMPLETE</div>
        <h1 ref={headingRef} tabIndex={-1} className={styles.journeyTitle}>
          Until next time
        </h1>
        <p className={styles.journeyDescription}>A goodbye at the doorstep.</p>
        <OutroScene elapsedMs={0} paused={paused} />
        <p className={styles.outroCaption}>The conversation ends. Time to reflect together.</p>
        <button type="button" className={styles.quiet} onClick={() => setOutroDone(true)}>
          Skip animation
        </button>
      </main>
    )
  }

  const messages = threadMessages(content, snapshot.history)
  const last = messages.at(-1)
  return (
    <main className={styles.journey}>
      <div className={styles.journeyKicker}>ENCOUNTER COMPLETE</div>
      <h1 ref={headingRef} tabIndex={-1} className={styles.journeyTitle}>
        Take a moment to reflect
      </h1>
      <p className={styles.journeyDescription}>Talk together about what you learned before starting another round.</p>
      {last ? <Message content={content} message={last} role={snapshot.myRole} latest /> : null}
      <ol className={styles.reflectionList}>
        {content.reflection.prompts.map((prompt, index) => (
          <li key={prompt} className={styles.reflectionRow}>
            <span className={styles.reflectionNumber} aria-hidden="true">
              {index + 1}
            </span>
            <p>{prompt}</p>
          </li>
        ))}
      </ol>
      <div className={styles.completionActions}>
        {content.hardMode ? (
          <>
            <p id={hardModeNoteId} className={styles.hardModeNote}>
              Ready for more? In Hard mode, the missionary responds to what the Christian says.
            </p>
            <Button disabled={!canAct} aria-describedby={hardModeNoteId} onClick={() => onSessionRequest('hardMode')}>
              Hard mode
            </Button>
          </>
        ) : null}
        <Button variant={content.hardMode ? 'secondary' : 'primary'} disabled={!canAct} onClick={() => onSessionRequest('swap')}>
          Switch roles
        </Button>
        <Button variant="secondary" disabled={!canAct} onClick={() => onSessionRequest('restart')}>
          Play again
        </Button>
        <button type="button" className={styles.quiet} onClick={onLeave}>
          Leave session
        </button>
      </div>
      <details className={styles.completedHistory}>
        <summary>Review your conversation</summary>
        {messages.map((message, index) => (
          <Message key={index} content={content} message={message} role={snapshot.myRole} latest={false} />
        ))}
      </details>
    </main>
  )
}
