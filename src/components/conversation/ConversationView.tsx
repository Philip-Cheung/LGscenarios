import { useContext, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CLARIFICATION_ID, CLOSING_ID, type ConversationContent } from '../../lib/conversation'
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
  type Beat,
  type ConversationProgress,
  type Responding,
  type ThreadMessage,
} from './model'
import { OpenPassageContext } from './passageContext'
import { Sheet } from './Sheet'

/** Messages kept in view; older ones fold into "Earlier messages". */
const VISIBLE_MESSAGES = 4
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
 * reply. Only "Speak aloud" commits anything.
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
  /** The history length at which the missionary said "They said something else". */
  const [heardFor, setHeardFor] = useState(-1)
  const [earlierOpen, setEarlierOpen] = useState(false)
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
  const responding = role === 'missionary' && !awaitingAnswer ? progress.responding : null
  // Without a matched reply, or once they say the Christian said something else, ask what they heard.
  const askWhatHeard = !!responding && (responding.matchedId === null || heardFor === history.length)
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

  const visible = messages.slice(-VISIBLE_MESSAGES)
  const earlier = messages.slice(0, -VISIBLE_MESSAGES)
  const latest = messages.at(-1)
  const allTopicsUsed = progress.started && !progress.responding && suggestNext(content, progress) === null
  // On the missionary's turn the composer becomes a choice card: a reply to
  // the Christian's answer, or what to ask next until only the closing remains.
  const card: Card | null = responding
    ? replyCard(content, progress, responding, askWhatHeard, missionaryDraftId, {
        somethingElse: () => {
          setHeardFor(history.length)
          setDraft({ forLength: history.length, id: null })
        },
        useSuggested: () => {
          setHeardFor(-1)
          setDraft({ forLength: history.length, id: responding.matchedId })
        },
      })
    : role === 'missionary' && !awaitingAnswer && progress.started && !allTopicsUsed
      ? directionCard(content, progress, missionaryDraftId, () => openSheet('questions'))
      : null

  let caption: string
  let note: string
  let text: string
  let hasDraft = false
  let sendLabel: string
  let canSend = false
  if (role === 'missionary') {
    if (awaitingAnswer) {
      caption = 'Conversation'
      note = 'Speak together aloud'
      text = 'Read your message aloud, then listen to your partner…'
      sendLabel = 'Waiting for Christian response'
    } else {
      const ownWords = missionaryDraftId === FREE_RESPONSE_ID
      hasDraft = !!missionaryDraft || ownWords
      caption = hasDraft ? 'Your next line' : 'Conversation'
      note = ownWords ? 'Reply aloud, then send' : hasDraft ? 'Read aloud after posting' : 'Speak together aloud'
      text = missionaryDraft?.text ?? 'Choose what to say…'
      sendLabel =
        missionaryDraftId === CLOSING_ID
          ? 'Send closing'
          : ownWords
            ? 'Confirm you replied aloud'
            : missionaryDraft?.next
              ? 'Send reply'
              : responding && !hasDraft
                ? 'Choose how to reply'
                : progress.started
                  ? 'Send question'
                  : 'Send introduction'
      canSend = hasDraft
    }
  } else if (awaitingAnswer) {
    hasDraft = !!christianText
    caption = hasDraft ? 'Your next line' : 'Your response'
    note = 'Speak aloud, then send'
    text = christianText ?? 'Respond aloud in your own words…'
    sendLabel = 'Send response'
    canSend = true
  } else {
    caption = 'Conversation'
    note = 'Speak together aloud'
    text = !progress.started
      ? 'Your visitor will introduce themselves first…'
      : progress.responding
        ? 'Your partner is responding to you…'
        : progress.afterReply
          ? 'Your partner is choosing how to continue…'
          : 'Your partner is choosing what to ask next…'
    sendLabel = 'Waiting for your partner'
  }

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
          {earlier.length > 0 ? (
            <details
              className={styles.earlier}
              open={earlierOpen}
              onToggle={(event) => setEarlierOpen(event.currentTarget.open)}
            >
              <summary>Earlier messages ({earlier.length})</summary>
              {earlier.map((message, index) => (
                <Message key={index} content={content} message={message} role={role} latest={false} />
              ))}
            </details>
          ) : null}
          {visible.map((message, index) => (
            <Message
              key={earlier.length + index}
              content={content}
              message={message}
              role={role}
              latest={index === visible.length - 1}
            />
          ))}
        </div>
        <p className={styles.srOnly} aria-live="polite">
          {latest ? `${content.roles[latest.speaker].speaker}: ${richTextOneLine(latest.text)}` : ''}
        </p>
      </main>
      <section className={card ? `${styles.tools} ${styles.toolsChoosing}` : styles.tools} aria-label="Private conversation choices">
        {role === 'christian' && awaitingAnswer ? (
          <div className={styles.helpEntry}>
            <button type="button" className={styles.helpTrigger} aria-haspopup="dialog" disabled={!canAct} onClick={() => openSheet('help')}>
              Need help?
            </button>
          </div>
        ) : null}
        {role === 'missionary' && !awaitingAnswer && progress.started && !card ? (
          <div className={styles.directionControls}>
            <button
              type="button"
              className={styles.directionToggle}
              aria-haspopup="dialog"
              disabled={!canAct}
              onClick={() => openSheet('questions')}
            >
              Take another direction
            </button>
          </div>
        ) : null}
        {role === 'missionary' && !awaitingAnswer && allTopicsUsed && !missionaryDraft ? (
          <div className={styles.suggestionChips}>
            <button type="button" className={styles.suggestion} disabled={!canAct} onClick={() => choose(CLOSING_ID)}>
              End the conversation
            </button>
          </div>
        ) : null}
        <div className={card ? `${styles.composeBox} ${styles.choiceCard}` : hasDraft ? `${styles.composeBox} ${styles.hasDraft}` : styles.composeBox}>
          {card ? (
            <ChoiceCard
              card={card}
              selectedId={missionaryDraftId}
              line={missionaryDraft?.text ?? null}
              disabled={!canAct}
              onChoose={choose}
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
            <span className={styles.composeNote}>{note}</span>
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
              Speak aloud
            </button>
          </div>
        </div>
      </section>

      {sheet === 'questions' && role === 'missionary' && !awaitingAnswer ? (
        <Sheet title="Choose your next question" closeLabel="Close questions" onClose={() => setSheet(null)} restoreFocusRef={restoreFocus}>
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
  const mine = message.speaker === role
  const classes = [styles.message, mine ? styles.mine : '', latest ? styles.latest : '', message.free ? styles.spokenReply : '']
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
          <span className={styles.ref}>{message.caption}</span>
        </div>
      </div>
    </div>
  )
}

/** One numbered row in the missionary's choice card. */
interface CardRow {
  id: string
  title: string
  /** Read by screen readers with the title. */
  summary: string
  badge?: 'Recommended' | 'Suggested'
  /** Shown under the row when it is chosen and has no line to read aloud. */
  note?: string
}

interface Card {
  heading: string
  rows: CardRow[]
  /** A link under the rows: more directions, or switching how to reply. */
  footer: { label: string; dialog: boolean; onClick(): void } | null
}

const ASK_TO_EXPLAIN = 'Ask them to explain'
const WRAP_UP = 'Wrap up conversation'

/**
 * A line chosen outside the card (the full list, or "Ask them to explain" /
 * "Wrap up" from the options menu) takes the first row, so the selection is
 * always visible.
 */
function withSelection(content: ConversationContent, rows: CardRow[], candidates: CardRow[], selectedId: string | null, size: number): CardRow[] {
  if (!selectedId || rows.some((row) => row.id === selectedId)) return rows
  const chosen =
    candidates.find((row) => row.id === selectedId) ??
    (selectedId === CLARIFICATION_ID
      ? { id: selectedId, title: ASK_TO_EXPLAIN, summary: richTextOneLine(content.clarification.text) }
      : selectedId === CLOSING_ID
        ? { id: selectedId, title: WRAP_UP, summary: 'End the conversation kindly.' }
        : null)
  return chosen ? [chosen, ...rows.slice(0, size - 1)] : rows
}

/** "What would you like to ask next?": the suggested line first, then the next directions. */
function directionCard(content: ConversationContent, progress: ConversationProgress, selectedId: string | null, onMore: () => void): Card {
  const { continueTopic, otherDirections } = directionChoices(content, progress)
  const all: CardRow[] = [...continueTopic, ...otherDirections].map((choice, index) => ({
    id: choice.beatId,
    title: choice.title,
    summary: choice.summary,
    badge: index === 0 ? 'Recommended' : undefined,
  }))
  const rows = withSelection(content, all.slice(0, CARD_CHOICES), all, selectedId, CARD_CHOICES)
  const more = all.filter((choice) => !rows.some((row) => row.id === choice.id)).length
  return {
    heading: 'What would you like to ask next?',
    rows,
    footer: more > 0 ? { label: `More directions (${more})`, dialog: true, onClick: onMore } : null,
  }
}

/**
 * The missionary's reply to the Christian's answer: the reply matched to the
 * answer they confirmed, or "What did your partner say?" after a free answer
 * or when the missionary heard something else. Their own words are always an
 * option, and the clarification is offered unless they just asked it.
 */
function replyCard(
  content: ConversationContent,
  progress: ConversationProgress,
  responding: Responding,
  askWhatHeard: boolean,
  selectedId: string | null,
  actions: { somethingElse(): void; useSuggested(): void },
): Card {
  const { respond } = responding.parent
  const replyRow = (id: string, title: string, badge?: CardRow['badge']): CardRow | null => {
    const reply = respond.replies.find((item) => item.id === id)
    return reply ? { id, title, summary: richTextOneLine(reply.text), badge } : null
  }
  const ownWords: CardRow = {
    id: FREE_RESPONSE_ID,
    title: 'I responded in my own words',
    summary: 'Reply aloud, then confirm.',
    note: 'Reply aloud in your own words, then tap Speak aloud.',
  }
  const candidates = respond.replies.flatMap((reply) => replyRow(reply.id, reply.label) ?? [])

  if (!askWhatHeard && responding.matchedId) {
    const matched = replyRow(responding.matchedId, respond.replies.find((reply) => reply.id === responding.matchedId)?.label ?? '', 'Suggested')
    const rows = [...(matched ? [matched] : []), ownWords]
    return {
      heading: 'Respond to your partner',
      rows: withSelection(content, rows, candidates, selectedId, rows.length + 1),
      footer: { label: 'They said something else', dialog: false, onClick: actions.somethingElse },
    }
  }

  const rows = [
    ...respond.heard.flatMap((heard) => replyRow(heard.reply, heard.label) ?? []),
    ...(canSpeak(content, progress, CLARIFICATION_ID)
      ? [{ id: CLARIFICATION_ID, title: 'Something else / help me clarify', summary: richTextOneLine(content.clarification.text) }]
      : []),
    ownWords,
  ]
  return {
    heading: 'What did your partner say?',
    rows: withSelection(content, rows, candidates, selectedId, rows.length + 1),
    footer: responding.matchedId ? { label: 'Use the suggested reply', dialog: false, onClick: actions.useSuggested } : null,
  }
}

/** The missionary's choice card: a question, a few numbered rows, and the selected line to read aloud. */
function ChoiceCard({
  card,
  selectedId,
  line,
  disabled,
  onChoose,
}: {
  card: Card
  selectedId: string | null
  line: string | null
  disabled: boolean
  onChoose(id: string): void
}) {
  const headingId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  const { rows, footer } = card
  // Number keys pick a row, but only while focus is inside the card.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return
    const row = rows[Number(event.key) - 1]
    if (!/^[1-9]$/.test(event.key) || !row) return
    event.preventDefault()
    onChoose(row.id)
  }
  return (
    <>
      <h2 id={headingId} className={styles.choiceHeading}>
        {card.heading}
      </h2>
      <div ref={groupRef} role="group" aria-labelledby={headingId} className={styles.choiceList} onKeyDown={onKeyDown}>
        {rows.map((row, index) => {
          const selected = row.id === selectedId
          const shown = selected ? (line ?? row.note ?? null) : null
          return (
            <div key={row.id} className={selected ? `${styles.choiceItem} ${styles.choiceSelected}` : styles.choiceItem}>
              <button
                type="button"
                className={styles.choiceRow}
                aria-pressed={selected}
                aria-label={`${index + 1}. ${row.title}${row.badge ? ` (${row.badge})` : ''}. ${row.summary}`}
                disabled={disabled}
                onClick={() => onChoose(row.id)}
              >
                <span className={styles.choiceNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.choiceRowTitle}>{row.title}</span>
                {row.badge ? (
                  <span className={styles.choiceBadge} aria-hidden="true">
                    {row.badge}
                  </span>
                ) : null}
              </button>
              {shown ? (
                <div className={styles.choiceLine}>
                  <div className={line ? styles.composerText : `${styles.composerText} ${styles.placeholder}`}>
                    <ConversationText text={shown} />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        {footer ? (
          <button
            type="button"
            className={styles.moreDirections}
            aria-haspopup={footer.dialog ? 'dialog' : undefined}
            disabled={disabled}
            onClick={() => {
              footer.onClick()
              // Switching how to reply replaces this link, so focus moves to the new first row.
              if (!footer.dialog) window.requestAnimationFrame(() => groupRef.current?.querySelector('button')?.focus())
            }}
          >
            {footer.label}
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

type HelpTab = 'hint' | 'responses' | 'context' | 'clarify' | null

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

  const label = (id: string) => content.passages.items.find((item) => item.id === id)?.label ?? id
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
                    {label(id)} · KJV
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
          <div className={styles.sheetSecondaryActions}>
            {help.passages.length > 0 ? (
              <button type="button" className={styles.helpDetailAction} onClick={() => setTab('context')}>
                Explain the verse
              </button>
            ) : null}
            {help.clarify ? (
              <button type="button" className={styles.helpDetailAction} onClick={() => setTab('clarify')}>
                Help me clarify
              </button>
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
