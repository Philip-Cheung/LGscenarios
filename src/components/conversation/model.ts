import { CLARIFICATION_ID, CLOSING_ID, OPENING_ID, type ConversationContent } from '../../lib/conversation'
import type { HistoryEntry, Role } from '../../sessions/types'

/**
 * Pure helpers that turn the server's committed history (ids only) into what
 * each phone shows, and decide which lines the missionary may speak next.
 * The server applies the same rules in commit_utterance; these only shape
 * the UI so it never offers a line the server would refuse.
 */

/** Response ids the Christian can commit; the server accepts exactly these shapes. */
export const FREE_RESPONSE_ID = 'free'
export const NOT_SURE_ID = 'not-sure'
export const answerId = (index: number) => `answer-${index + 1}`

export interface ThreadMessage {
  speaker: Role
  /** The line as rich text; the free response is the neutral marker, never a transcript. */
  text: string
  caption: string
  /** A passage the caption opens. */
  passage?: string
  /** The Christian answered in their own words. */
  free: boolean
}

export interface BeatHelp {
  /** The introduction only offers a simple welcome. */
  greeting: boolean
  prompt?: string
  hint?: string
  answers: readonly string[]
  clarify?: string
  context?: string
  passages: readonly string[]
  note?: string
  evidence?: { heading: string; text: string; context?: string }
  reading?: { label: string; url: string }
}

/** An authored missionary line, with where it sits in the conversation. */
export interface Beat {
  id: string
  text: string
  caption: string
  /** A passage the caption opens. */
  passage?: string
  help: BeatHelp | null
  /** The topic a question or follow-up belongs to. */
  topicId: string | null
}

export function findBeat(content: ConversationContent, id: string): Beat | null {
  if (id === OPENING_ID) {
    const { opening } = content
    return {
      id,
      text: opening.text,
      caption: opening.caption,
      help: { greeting: true, prompt: opening.help.prompt, answers: opening.help.answers, passages: [] },
      topicId: null,
    }
  }
  if (id === CLARIFICATION_ID) {
    const { clarification } = content
    if (!clarification) return null
    return {
      id,
      text: clarification.text,
      caption: clarification.caption,
      help: { greeting: false, hint: clarification.help.hint, answers: clarification.help.answers, passages: [] },
      topicId: null,
    }
  }
  if (id === CLOSING_ID) {
    return { id, text: content.closing.text, caption: content.closing.caption, help: null, topicId: null }
  }
  for (const topic of content.topics) {
    for (const item of [topic.question, ...topic.followUps]) {
      if (item.id !== id) continue
      return {
        id,
        text: item.text,
        caption: item.caption,
        passage: item.passage,
        help: {
          greeting: false,
          hint: item.help.hint,
          answers: item.help.answers,
          clarify: item.help.clarify,
          context: item.help.context,
          passages: item.help.passages ?? [],
          note: item.help.note,
          evidence: item.help.evidence,
          reading: item.help.reading,
        },
        topicId: topic.id,
      }
    }
  }
  return null
}

/** The Christian's reply options for a beat, in order, with the ids the server accepts. */
export function responseOptions(content: ConversationContent, beat: Beat): { id: string; text: string }[] {
  const answers = (beat.help?.answers ?? []).map((text, index) => ({ id: answerId(index), text }))
  if (beat.id === OPENING_ID || !content.notSureAnswer) return answers
  return [...answers, { id: NOT_SURE_ID, text: content.notSureAnswer }]
}

/** The text of a Christian response, or null for the free marker or an unknown id. */
export function responseText(content: ConversationContent, beat: Beat | null, id: string): string | null {
  if (!beat || id === FREE_RESPONSE_ID) return null
  if (id === NOT_SURE_ID) return content.notSureAnswer ?? null
  if (id === CLARIFICATION_ID) return beat.help?.clarify ?? null
  const match = /^answer-([1-9])$/.exec(id)
  return match ? (beat.help?.answers[Number(match[1]) - 1] ?? null) : null
}

export const FREE_RESPONSE_TEXT = 'Answered aloud'
const FREE_RESPONSE_CAPTION = 'Spoken response · not transcribed'
const SUGGESTED_RESPONSE_CAPTION = 'Suggested response · confirmed aloud'

/** The shared thread, rebuilt from history. Unknown ids are skipped rather than guessed. */
export function threadMessages(content: ConversationContent, history: readonly HistoryEntry[]): ThreadMessage[] {
  const messages: ThreadMessage[] = []
  let lastBeat: Beat | null = null
  for (const entry of history) {
    if (entry.speaker === 'missionary') {
      lastBeat = findBeat(content, entry.id)
      if (lastBeat) {
        messages.push({ speaker: 'missionary', text: lastBeat.text, caption: lastBeat.caption, passage: lastBeat.passage, free: false })
      }
      continue
    }
    if (entry.id === FREE_RESPONSE_ID) {
      messages.push({ speaker: 'christian', text: FREE_RESPONSE_TEXT, caption: FREE_RESPONSE_CAPTION, free: true })
      continue
    }
    const text = responseText(content, lastBeat, entry.id)
    if (text) messages.push({ speaker: 'christian', text, caption: SUGGESTED_RESPONSE_CAPTION, free: false })
  }
  return messages
}

export interface ConversationProgress {
  /** The missionary has spoken the introduction. */
  started: boolean
  /** Committed missionary lines, in order. */
  spoken: readonly string[]
  /** The missionary line the Christian is answering, or answered last. */
  lastBeat: Beat | null
  /** The topic of the most recent question or follow-up; a clarification keeps it. */
  activeTopicId: string | null
  /** Topics whose main question has been asked. */
  askedTopicIds: ReadonlySet<string>
}

export function conversationProgress(content: ConversationContent, history: readonly HistoryEntry[]): ConversationProgress {
  const spoken = history.filter((entry) => entry.speaker === 'missionary').map((entry) => entry.id)
  let activeTopicId: string | null = null
  const askedTopicIds = new Set<string>()
  for (const id of spoken) {
    const beat = findBeat(content, id)
    if (beat?.topicId) activeTopicId = beat.topicId
    const topic = content.topics.find((item) => item.question.id === id)
    if (topic) askedTopicIds.add(topic.id)
  }
  const last = spoken.at(-1)
  return {
    started: spoken.length > 0,
    spoken,
    lastBeat: last ? findBeat(content, last) : null,
    activeTopicId,
    askedTopicIds,
  }
}

/** One numbered row in "Choose your next question". */
export interface DirectionChoice {
  beatId: string
  title: string
  summary: string
}

export interface DirectionChoices {
  /** Unspoken follow-ups of the active topic. */
  continueTopic: DirectionChoice[]
  /** Topics whose question has not been asked yet. */
  otherDirections: DirectionChoice[]
}

export function directionChoices(content: ConversationContent, progress: ConversationProgress): DirectionChoices {
  const spoken = new Set(progress.spoken)
  const active = content.topics.find((topic) => topic.id === progress.activeTopicId)
  return {
    continueTopic: (active?.followUps ?? [])
      .filter((followUp) => !spoken.has(followUp.id))
      .map((followUp) => ({ beatId: followUp.id, title: followUp.title, summary: followUp.summary })),
    otherDirections: content.topics
      .filter((topic) => !progress.askedTopicIds.has(topic.id))
      .map((topic) => ({ beatId: topic.question.id, title: topic.title, summary: topic.summary })),
  }
}

/**
 * The missionary's next suggested line: the introduction, then the next
 * follow-up in the active topic, then the next topic not yet asked, and the
 * closing once every topic is exhausted.
 */
export function suggestNext(content: ConversationContent, progress: ConversationProgress): string {
  if (!progress.started) return OPENING_ID
  const { continueTopic, otherDirections } = directionChoices(content, progress)
  return continueTopic[0]?.beatId ?? otherDirections[0]?.beatId ?? CLOSING_ID
}

/** Every question and follow-up the missionary can still reach has been spoken; only the closing remains. */
export function topicsExhausted(content: ConversationContent, progress: ConversationProgress): boolean {
  return progress.started && suggestNext(content, progress) === CLOSING_ID
}

/** Whether the missionary may speak this line next; mirrors commit_utterance. */
export function canSpeak(content: ConversationContent, progress: ConversationProgress, id: string): boolean {
  if (!progress.started) return id === OPENING_ID
  if (id === CLOSING_ID) return true
  if (id === CLARIFICATION_ID) {
    return !!content.clarification && progress.activeTopicId !== null && progress.spoken.at(-1) !== CLARIFICATION_ID
  }
  if (progress.spoken.includes(id)) return false
  if (content.topics.some((topic) => topic.question.id === id)) return true
  const beat = findBeat(content, id)
  return !!beat?.topicId && beat.topicId === progress.activeTopicId
}
