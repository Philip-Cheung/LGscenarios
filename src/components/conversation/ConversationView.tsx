import { useContext, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CLARIFICATION_ID, CLOSING_ID, OPENING_ID, type ConversationContent } from '../../lib/conversation'
import { richTextOneLine } from '../../lib/richText'
import type { Role, SessionSnapshot } from '../../sessions/types'
import { Portrait } from './art'
import styles from './conversation.module.css'
import { ConversationText } from './ConversationText'
import {
  canSpeak,
  conversationProgress,
  directionChoices,
  findBeat,
  FREE_RESPONSE_ID,
  responseOptions,
  responseText,
  suggestNext,
  threadMessages,
  topicsExhausted,
  type Beat,
  type DirectionChoice,
  type ThreadMessage,
} from './model'
import { OpenPassageContext } from './passageContext'
import { Sheet } from './Sheet'

/** Within this distance of the bottom, a new message scrolls into view. */
const NEAR_BOTTOM_PX = 96
/** Rows in the missionary's choice card; the rest are under "More directions". */
const CARD_CHOICES = 3

type SheetKind = 'questions' | 'help' | 'options'
export type SessionRequestKind = 'restart' | 'swap'

interface ConversationViewProps {
  content: ConversationContent
  snapshot: SessionSnapshot
  canAct: boolean
  /** A request, lost connection, or absent partner closes any open sheet. */
  interrupted: boolean
  sending: boolean
  onCommit(itemId: string): void
  onSessionRequest(kind: SessionRequestKind): void
}

/** A draft that belongs to one turn; a new history entry discards it. */
interface Draft {
  forLength: number
  id: string | null
}

/**
 * The doorstep conversation: a shared thread rebuilt from the server's
 * history, and a private composer. The missionary prepares a line and speaks
 * it aloud; the Christian answers in their own words or picks a suggested
 * reply. Only the send button ("Ask question", "Answer question", or "Speak
 * aloud" in scenarios that set `speakAloud`) commits anything.
 */
export function ConversationView({
  content,
  snapshot,
  canAct,
  interrupted,
  sending,
  onCommit,
  onSessionRequest,
}: ConversationViewProps) {
  const role = snapshot.myRole
  const { history } = snapshot
  const progress = useMemo(() => conversationProgress(content, history), [content, history])
  const messages = useMemo(() => threadMessages(content, history), [content, history])
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const [draft, setDraft] = useState<Draft>({ forLength: -1, id: null })
  const restoreFocus = useRef(true)
  const sendRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLElement>(null)
  const nearBottom = useRef(true)
  if (interrupted && sheet) setSheet(null)

  const awaitingAnswer = snapshot.turn === 'christian'
  const myTurn = snapshot.turn === role
  const chosenId = draft.forLength === history.length ? draft.id : null
  const usable = canAct && !sending

  // The missionary's draft: their choice for this turn, else the suggested next line.
  const missionaryDraftId = (() => {
    if (role !== 'missionary' || awaitingAnswer) return null
    const id = draft.forLength === history.length ? draft.id : suggestNext(content, progress)
    return id && canSpeak(content, progress, id) ? id : null
  })()
  const missionaryDraft = missionaryDraftId ? findBeat(content, missionaryDraftId) : null
  const christianText =
    role === 'christian' && awaitingAnswer && chosenId ? responseText(content, progress.lastBeat, chosenId) : null

  // Only a new line moves the reader, and only if they were already at the
  // bottom or spoke it themselves; reading older messages is left alone.
  const shownLength = useRef(-1)
  useLayoutEffect(() => {
    const pane = scrollRef.current
    if (!pane || shownLength.current === history.length) return
    shownLength.current = history.length
    if (nearBottom.current || history.at(-1)?.speaker === role) pane.scrollTop = pane.scrollHeight
  }, [history, role])

  // When the composer grows or shrinks, a reader at the bottom stays at the bottom.
  useLayoutEffect(() => {
    const pane = scrollRef.current
    if (!pane || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) pane.scrollTop = pane.scrollHeight
    })
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])

  const choose = (id: string | null) => {
    setDraft({ forLength: history.length, id })
    restoreFocus.current = false
    setSheet(null)
    window.requestAnimationFrame(() => sendRef.current?.focus())
  }

  const openSheet = (kind: SheetKind) => {
    if (!canAct) return
    setSheet(kind)
  }

  const send = () => {
    if (!usable || !myTurn) return
    if (role === 'missionary') {
      if (missionaryDraftId) onCommit(missionaryDraftId)
      return
    }
    onCommit(chosenId ?? FREE_RESPONSE_ID)
  }

  const latest = messages.at(-1)
  const allTopicsUsed = topicsExhausted(content, progress)
  // On the missionary's turn the composer becomes a choice card, until only the closing remains.
  const card = role === 'missionary' && !awaitingAnswer && progress.started && !allTopicsUsed ? cardChoices(content, progress, missionaryDraftId) : null
  const speakAloud = content.speakAloud === true
  // Shown once: the turn comes back to the missionary after the introduction exchange.
  const turnCue = role === 'missionary' && !awaitingAnswer && progress.spoken.length === 1

  let caption: string
  let note: string
  /** The note is an instruction that needs its own line. */
  let instruction = false
  let text: string
  let hasDraft = false
  let sendLabel: string
  let sendText: string
  let canSend = false
  if (role === 'missionary') {
    if (awaitingAnswer) {
      caption = 'Conversation'
      note = 'Speak together aloud'
      text = speakAloud ? 'Listen to your partner’s answer…' : 'Read your message aloud, then listen to your partner…'
      sendLabel = 'Waiting for Christian response'
      sendText = speakAloud ? 'Speak aloud' : 'Ask question'
    } else {
      hasDraft = !!missionaryDraft
      const closing = missionaryDraftId === CLOSING_ID
      caption = hasDraft ? 'Your next line' : 'Conversation'
      text = missionaryDraft?.text ?? 'Choose what to say…'
      sendText = speakAloud ? 'Speak aloud' : closing ? 'Say goodbye' : progress.started ? 'Ask question' : 'Introduce'
      sendLabel = closing ? 'Send closing' : progress.started ? 'Send question' : 'Send introduction'
      if (speakAloud && hasDraft) {
        instruction = true
        note = closing ? `Say goodbye to your partner. Then tap ${sendText} to finish.` : `Read this to your partner. Then tap ${sendText}.`
      } else {
        note = hasDraft ? 'Read aloud after posting' : 'Speak together aloud'
      }
      canSend = hasDraft
    }
  } else if (awaitingAnswer) {
    hasDraft = !!christianText
    caption = hasDraft ? 'Your next line' : 'Your response'
    sendText = speakAloud ? 'Speak aloud' : 'Answer question'
    if (speakAloud) {
      instruction = true
      note = hasDraft
        ? `When you’ve answered, tap ${sendText}.`
        : progress.lastBeat?.id === OPENING_ID
          ? 'Answer in your own words. Tap Need help? if you’d like a suggested answer.'
          : 'Try to answer on your own first'
    } else {
      note = hasDraft ? 'Say it aloud, then tap Answer question' : 'Try to answer on your own first'
    }
    text = christianText ?? 'Respond aloud in your own words…'
    sendLabel = 'Send response'
    canSend = true
  } else {
    caption = 'Conversation'
    note = 'Speak together aloud'
    sendText = speakAloud ? 'Speak aloud' : 'Answer question'
    text = !progress.started
      ? 'Your visitor will introduce themselves first…'
      : allTopicsUsed
        ? 'Your partner is finishing the conversation.'
        : speakAloud
          ? 'Your partner is choosing what to say next…'
          : 'Your partner is choosing what to ask next…'
    sendLabel = 'Waiting for your partner'
  }
  const noteClass = instruction
    ? `${styles.composeNote} ${styles.composeHint} ${styles.composeInstruction}`
    : role === 'christian' && awaitingAnswer
      ? `${styles.composeNote} ${styles.composeHint}`
      : styles.composeNote

  return (
    <>
      <main
        ref={scrollRef}
        className={card ? `${styles.conversation} ${styles.conversationChoosing}` : styles.conversation}
        onScroll={(event) => {
          const pane = event.currentTarget
          nearBottom.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < NEAR_BOTTOM_PX
        }}
      >
        <h1 className={styles.srOnly}>Conversation</h1>
        <p className={styles.sceneContext}>The door is open. Your conversation begins here.</p>
        <div className={styles.thread} aria-label="Conversation prompts" role="region">
          {messages.map((message, index) => (
            <Message key={index} content={content} message={message} role={role} latest={index === messages.length - 1} />
          ))}
        </div>
        <p className={styles.srOnly} aria-live="polite">
          {latest ? `${content.roles[latest.speaker].speaker}: ${richTextOneLine(latest.text)}` : ''}
        </p>
      </main>
      <section className={card ? `${styles.tools} ${styles.toolsChoosing}` : styles.tools} aria-label="Private conversation choices">
        {turnCue ? (
          <p className={styles.turnCue} role="status">
            It’s your turn again. Your next line is ready below.
          </p>
        ) : null}
        {role === 'christian' && awaitingAnswer ? (
          <div className={styles.helpEntry}>
            <button type="button" className={styles.helpTrigger} aria-haspopup="dialog" disabled={!canAct} onClick={() => openSheet('help')}>
              <span className={styles.helpIcon} aria-hidden="true">
                ?
              </span>
              Need help?
            </button>
          </div>
        ) : null}
        <div className={card ? `${styles.composeBox} ${styles.choiceCard}` : hasDraft ? `${styles.composeBox} ${styles.hasDraft}` : styles.composeBox}>
          {card ? (
            <NextChoices
              heading={speakAloud ? 'What would you like to say next?' : 'What would you like to ask next?'}
              choices={card.rows}
              recommendedId={card.recommendedId}
              selectedId={missionaryDraftId}
              line={missionaryDraft?.text ?? null}
              more={card.more}
              disabled={!canAct}
              onChoose={choose}
              onMore={() => openSheet('questions')}
            />
          ) : (
            <>
              <div className={styles.composeCaption}>{caption}</div>
              <div className={hasDraft ? styles.composerText : `${styles.composerText} ${styles.placeholder}`}>
                <ConversationText text={text} />
              </div>
            </>
          )}
          <div className={card ? `${styles.composeBar} ${styles.choiceBar}` : styles.composeBar}>
            <button
              type="button"
              className={styles.composeMore}
              aria-label="More conversation options"
              aria-haspopup="dialog"
              aria-expanded={sheet === 'options'}
              disabled={!canAct}
              onClick={() => openSheet('options')}
            >
              +
            </button>
            <span className={noteClass}>{note}</span>
            {hasDraft && role === 'christian' ? (
              <button
                type="button"
                className={styles.composeClear}
                aria-label="Clear draft"
                onClick={() => {
                  setDraft({ forLength: history.length, id: null })
                  sendRef.current?.focus()
                }}
              >
                ×
              </button>
            ) : null}
            <button
              ref={sendRef}
              type="button"
              className={styles.composeSend}
              aria-label={sendLabel}
              aria-busy={sending || undefined}
              disabled={!canSend || !usable}
              onClick={send}
            >
              {sendText}
            </button>
          </div>
        </div>
      </section>

      {sheet === 'questions' && role === 'missionary' && !awaitingAnswer ? (
        <Sheet
          title={speakAloud ? 'Choose your next line' : 'Choose your next question'}
          closeLabel="Close questions"
          onClose={() => setSheet(null)}
          restoreFocusRef={restoreFocus}
        >
          <QuestionChoices content={content} snapshot={snapshot} selectedId={missionaryDraftId} onChoose={choose} />
        </Sheet>
      ) : null}
      {sheet === 'help' && role === 'christian' && awaitingAnswer && progress.lastBeat ? (
        <Sheet title="Help with your reply" closeLabel="Close help" onClose={() => setSheet(null)} restoreFocusRef={restoreFocus}>
          <ReplyHelp content={content} beat={progress.lastBeat} onChoose={choose} />
        </Sheet>
      ) : null}
      {sheet === 'options' ? (
        <Sheet title="Resources & options" closeLabel="Close options" onClose={() => setSheet(null)} restoreFocusRef={restoreFocus}>
          <OptionsMenu
            content={content}
            snapshot={snapshot}
            onChoose={choose}
            onSessionRequest={(kind) => {
              setSheet(null)
              onSessionRequest(kind)
            }}
          />
        </Sheet>
      ) : null}
    </>
  )
}

export function Message({
  content,
  message,
  role,
  latest,
}: {
  content: ConversationContent
  message: ThreadMessage
  role: Role
  latest: boolean
}) {
  const openPassage = useContext(OpenPassageContext)
  const mine = message.speaker === role
  const classes = [styles.message, mine ? styles.mine : '', latest ? styles.latest : '', message.free ? styles.spokenReply : '']
  const { passage } = message
  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <div className={styles.speaker}>
        {content.roles[message.speaker].speaker}
        {mine ? ' (You)' : ''}
      </div>
      <div className={styles.messageRow}>
        <Portrait role={message.speaker} />
        <div className={styles.bubble}>
          <span>
            <ConversationText text={message.text} />
          </span>
          {passage && openPassage ? (
            <button
              type="button"
              className={`${styles.ref} ${styles.refLink}`}
              aria-haspopup="dialog"
              aria-label={`${message.caption} — read the passage`}
              onClick={() => openPassage(passage)}
            >
              {message.caption}
            </button>
          ) : (
            <span className={styles.ref}>{message.caption}</span>
          )}
        </div>
      </div>
    </div>
  )
}

interface CardChoices {
  rows: DirectionChoice[]
  recommendedId: string | null
  /** Directions not shown in the card. */
  more: number
}

/**
 * The card's rows: the suggested line first, then the next directions. A line
 * chosen elsewhere (the full list, or "Ask them to explain" / "Wrap up" from
 * the options menu) takes the first row so the selection is always visible.
 */
function cardChoices(content: ConversationContent, progress: ReturnType<typeof conversationProgress>, selectedId: string | null): CardChoices {
  const { continueTopic, otherDirections } = directionChoices(content, progress)
  const all = [...continueTopic, ...otherDirections]
  let rows = all.slice(0, CARD_CHOICES)
  if (selectedId && !rows.some((row) => row.beatId === selectedId)) {
    const chosen =
      all.find((row) => row.beatId === selectedId) ??
      (selectedId === CLARIFICATION_ID && content.clarification
        ? { beatId: selectedId, title: 'Ask them to explain', summary: richTextOneLine(content.clarification.text) }
        : selectedId === CLOSING_ID
          ? { beatId: selectedId, title: 'Wrap up conversation', summary: 'End the conversation kindly.' }
          : null)
    if (chosen) rows = [chosen, ...rows.slice(0, CARD_CHOICES - 1)]
  }
  return {
    rows,
    recommendedId: all[0]?.beatId ?? null,
    more: all.filter((choice) => !rows.some((row) => row.beatId === choice.beatId)).length,
  }
}

/** The missionary's choice card: a question, a few numbered rows, and the selected line to read aloud. */
function NextChoices({
  heading,
  choices,
  recommendedId,
  selectedId,
  line,
  more,
  disabled,
  onChoose,
  onMore,
}: {
  heading: string
  choices: DirectionChoice[]
  recommendedId: string | null
  selectedId: string | null
  line: string | null
  /** Directions not shown; they open in the full list. */
  more: number
  disabled: boolean
  onChoose(id: string): void
  onMore(): void
}) {
  const headingId = useId()
  // Number keys pick a row, but only while focus is inside the card.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return
    const choice = choices[Number(event.key) - 1]
    if (!/^[1-9]$/.test(event.key) || !choice) return
    event.preventDefault()
    onChoose(choice.beatId)
  }
  return (
    <>
      <h2 id={headingId} className={styles.choiceHeading}>
        {heading}
      </h2>
      <div role="group" aria-labelledby={headingId} className={styles.choiceList} onKeyDown={onKeyDown}>
        {choices.map((choice, index) => {
          const selected = choice.beatId === selectedId
          const recommended = choice.beatId === recommendedId
          return (
            <div key={choice.beatId} className={selected ? `${styles.choiceItem} ${styles.choiceSelected}` : styles.choiceItem}>
              <button
                type="button"
                className={styles.choiceRow}
                aria-pressed={selected}
                aria-label={`${index + 1}. ${choice.title}${recommended ? ' (Recommended)' : ''}. ${choice.summary}`}
                disabled={disabled}
                onClick={() => onChoose(choice.beatId)}
              >
                <span className={styles.choiceNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.choiceRowTitle}>{choice.title}</span>
                {recommended ? (
                  <span className={styles.choiceBadge} aria-hidden="true">
                    Recommended
                  </span>
                ) : null}
              </button>
              {selected && line ? (
                <div className={styles.choiceLine}>
                  <div className={styles.composerText}>
                    <ConversationText text={line} />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        {more > 0 ? (
          <button type="button" className={styles.moreDirections} aria-haspopup="dialog" disabled={disabled} onClick={onMore}>
            More directions ({more})
          </button>
        ) : null}
      </div>
    </>
  )
}

function NumberedChoice({
  index,
  title,
  summary,
  selected,
  onClick,
}: {
  index: number
  title: string
  summary: string
  selected: boolean
  onClick(): void
}) {
  return (
    <button type="button" className={styles.numberedChoice} aria-pressed={selected} aria-label={`${index}. ${title}. ${summary}`} onClick={onClick}>
      <span className={styles.choiceNumber} aria-hidden="true">
        {index}
      </span>
      <span className={styles.choiceCopy}>
        <span className={styles.choiceTitle}>{title}</span>
        <span className={styles.choiceQuestion}>{summary}</span>
      </span>
    </button>
  )
}

function QuestionChoices({
  content,
  snapshot,
  selectedId,
  onChoose,
}: {
  content: ConversationContent
  snapshot: SessionSnapshot
  selectedId: string | null
  onChoose(id: string): void
}) {
  const progress = conversationProgress(content, snapshot.history)
  const { continueTopic, otherDirections } = directionChoices(content, progress)
  const otherHeading = progress.activeTopicId ? 'Other directions' : 'Choose a direction'
  let number = 1
  return (
    <div className={styles.numberedOptions}>
      {continueTopic.length > 0 ? (
        <>
          <h3 className={styles.optionsHeading}>Continue this topic</h3>
          {continueTopic.map((choice) => (
            <NumberedChoice
              key={choice.beatId}
              index={number++}
              title={choice.title}
              summary={choice.summary}
              selected={selectedId === choice.beatId}
              onClick={() => onChoose(choice.beatId)}
            />
          ))}
        </>
      ) : null}
      {otherDirections.length > 0 ? (
        <>
          <h3 className={styles.optionsHeading}>{otherHeading}</h3>
          {otherDirections.map((choice) => (
            <NumberedChoice
              key={choice.beatId}
              index={number++}
              title={choice.title}
              summary={choice.summary}
              selected={selectedId === choice.beatId}
              onClick={() => onChoose(choice.beatId)}
            />
          ))}
        </>
      ) : null}
      {continueTopic.length === 0 && otherDirections.length === 0 ? (
        <>
          <p className={styles.sheetIntro}>You’ve explored every direction. Wrap up when you’re ready.</p>
          <button type="button" className={styles.menuItem} onClick={() => onChoose(CLOSING_ID)}>
            Wrap up conversation
          </button>
        </>
      ) : null}
    </div>
  )
}

type HelpTab = 'hint' | 'responses' | 'context' | 'clarify' | 'note' | 'evidence' | null

function ReplyHelp({ content, beat, onChoose }: { content: ConversationContent; beat: Beat; onChoose(id: string): void }) {
  const [tab, setTab] = useState<HelpTab>(null)
  const openPassage = useContext(OpenPassageContext)
  const help = beat.help
  if (!help) return null
  const options = responseOptions(content, beat)

  if (help.greeting) {
    return (
      <>
        <p className={styles.sheetIntro}>{help.prompt}</p>
        {options.map((option) => (
          <button key={option.id} type="button" className={styles.responseChoice} onClick={() => onChoose(option.id)}>
            {richTextOneLine(option.text)}
          </button>
        ))}
      </>
    )
  }

  const label = (id: string) => {
    const passage = content.passages.items.find((item) => item.id === id)
    return passage ? `${passage.label} · ${passage.source ?? 'KJV'}` : id
  }
  return (
    <>
      <div className={styles.helpTabs} role="group" aria-label="Choose the help you need">
        <button type="button" className={styles.helpTab} aria-pressed={tab === 'hint'} onClick={() => setTab('hint')}>
          Hint
        </button>
        <button type="button" className={styles.helpTab} aria-pressed={tab === 'responses'} onClick={() => setTab('responses')}>
          Suggested responses
        </button>
      </div>
      {tab === null ? (
        <p className={styles.sheetIntro}>Start with a hint, or choose words you can say aloud.</p>
      ) : (
        <section className={styles.sheetHelpContent}>
          {tab === 'hint' ? (
            <>
              <h3 className={styles.sheetSectionTitle}>A starting point</h3>
              <p>
                <ConversationText text={help.hint ?? ''} />
              </p>
            </>
          ) : null}
          {tab === 'responses' ? (
            <>
              <h3 className={styles.sheetSectionTitle}>Choose a response</h3>
              {options.map((option) => (
                <button key={option.id} type="button" className={styles.responseChoice} onClick={() => onChoose(option.id)}>
                  {richTextOneLine(option.text)}
                </button>
              ))}
            </>
          ) : null}
          {tab === 'context' ? (
            <>
              <h3 className={styles.sheetSectionTitle}>Read in context</h3>
              <p>
                <ConversationText text={help.context ?? help.hint ?? ''} />
              </p>
              <div className={styles.supportPassages}>
                {help.passages.map((id) => (
                  <button key={id} type="button" className={styles.passageReference} aria-haspopup="dialog" onClick={() => openPassage?.(id)}>
                    {label(id)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {tab === 'clarify' && help.clarify ? (
            <>
              <h3 className={styles.sheetSectionTitle}>Ask a clarifying question</h3>
              <button type="button" className={styles.responseChoice} onClick={() => onChoose(CLARIFICATION_ID)}>
                {richTextOneLine(help.clarify)}
              </button>
            </>
          ) : null}
          {tab === 'note' && help.note ? (
            <>
              <h3 className={styles.sheetSectionTitle}>Learning note</h3>
              <p>{help.note}</p>
            </>
          ) : null}
          {tab === 'evidence' && help.evidence ? (
            <>
              <h3 className={styles.sheetSectionTitle}>{help.evidence.heading}</h3>
              <p>{help.evidence.text}</p>
              {help.evidence.context ? <p className={styles.evidenceContext}>{help.evidence.context}</p> : null}
            </>
          ) : null}
          <div className={styles.sheetSecondaryActions}>
            {help.passages.length > 0 ? (
              <button type="button" className={styles.helpDetailAction} onClick={() => setTab('context')}>
                Explain the verse
              </button>
            ) : null}
            {help.evidence ? (
              <button type="button" className={styles.helpDetailAction} onClick={() => setTab('evidence')}>
                {help.evidence.heading}
              </button>
            ) : null}
            {help.note ? (
              <button type="button" className={styles.helpDetailAction} onClick={() => setTab('note')}>
                Learning note
              </button>
            ) : null}
            {help.clarify ? (
              <button type="button" className={styles.helpDetailAction} onClick={() => setTab('clarify')}>
                Help me clarify
              </button>
            ) : null}
            {help.reading ? (
              <a
                className={styles.helpDetailAction}
                href={help.reading.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${help.reading.label}, opens in a new tab`}
              >
                {help.reading.label} ↗
              </a>
            ) : null}
          </div>
        </section>
      )}
    </>
  )
}

function OptionsMenu({
  content,
  snapshot,
  onChoose,
  onSessionRequest,
}: {
  content: ConversationContent
  snapshot: SessionSnapshot
  onChoose(id: string): void
  onSessionRequest(kind: SessionRequestKind): void
}) {
  const role = snapshot.myRole
  const progress = conversationProgress(content, snapshot.history)
  const missionaryTurn = role === 'missionary' && snapshot.turn === 'missionary'
  const topic = content.topics.find((item) => item.id === progress.activeTopicId)
  return (
    <div className={styles.composeMenu}>
      <nav className={styles.resourceSection} aria-label="Weekly reading resources">
        <h3 className={styles.resourceTitle}>Resources</h3>
        <p className={styles.resourceSubtitle}>{content.resources.source}</p>
        {content.resources.items.map((item) => (
          <a
            key={item.url}
            className={styles.resourceLink}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${item.title}, ${item.format}, opens in a new tab`}
          >
            <span className={styles.resourceIcon} aria-hidden="true">
              {item.format === 'PDF' ? 'PDF' : 'WEB'}
            </span>
            <span className={styles.resourceCopy}>
              <span className={styles.resourceName}>{item.title}</span>
              <span className={styles.resourceFormat}>{item.format} · opens in new tab</span>
            </span>
            <span className={styles.resourceArrow} aria-hidden="true">
              ↗
            </span>
          </a>
        ))}
      </nav>
      {missionaryTurn && canSpeak(content, progress, CLARIFICATION_ID) ? (
        <button type="button" className={styles.menuItem} onClick={() => onChoose(CLARIFICATION_ID)}>
          Ask them to explain
        </button>
      ) : null}
      {role === 'missionary' && topic ? (
        <details className={styles.background}>
          <summary>Background for this topic</summary>
          <p>
            <ConversationText text={topic.background} />
          </p>
        </details>
      ) : null}
      <button type="button" className={styles.menuItem} onClick={() => onSessionRequest('restart')}>
        Restart round
      </button>
      <button type="button" className={styles.menuItem} onClick={() => onSessionRequest('swap')}>
        Switch roles
      </button>
      {missionaryTurn && progress.started ? (
        <button type="button" className={styles.menuItem} onClick={() => onChoose(CLOSING_ID)}>
          Wrap up conversation
        </button>
      ) : null}
    </div>
  )
}
