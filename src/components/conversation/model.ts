import {
  CLARIFICATION_ID,
  CLOSING_ID,
  NOT_SURE_ID,
  OPENING_ID,
  OWN_WORDS_ID,
  type ConversationAnswer,
  type ConversationContent,
  type ConversationReply,
  type ConversationRespond,
} from '../../lib/conversation'
import type { HistoryEntry, Role } from '../../sessions/types'

/**
 * Pure helpers that turn the server's committed history (ids only) into what
 * each phone shows, and decide which lines the missionary may speak next.
 * The server applies the same rules in commit_utterance; these only shape
 * the UI so it never offers a line the server would refuse.
 */

/**
 * Ids anyone can commit without authored text: the Christian's free answer,
 * the missionary's reply in their own words (3.1), and "not sure".
 */
export const FREE_RESPONSE_ID = OWN_WORDS_ID
export { NOT_SURE_ID }
/** Positional answer ids, used where answers have no ids of their own (3.0, the opening, the clarification). */
export const answerId = (index: number) => `answer-${index + 1}`

export interface ThreadMessage {
  speaker: Role
  /** The line as rich text; a free response is a neutral marker, never a transcript. */
  text: string
  caption: string
  /** Spoken in their own words. */
  free: boolean
}

/** A suggested Christian answer, with the id the server accepts. */
export interface ResponseOption {
  id: string
  text: string
  /** The missionary reply this answer leads to (3.1). */
  reply?: string
}

export interface BeatHelp {
  /** The introduction only offers a simple welcome. */
  greeting: boolean
  prompt?: string
  hint?: string
  answers: readonly ResponseOption[]
  clarify?: string
  context?: string
  passages: readonly string[]
}

/** An authored missionary line, with where it sits in the conversation. */
export interface Beat {
  id: string
  text: string
  caption: string
  help: BeatHelp | null
  /** The topic a question or follow-up belongs to; replies keep the active topic. */
  topicId: string | null
  /** The missionary's replies to the Christian's answer (3.1 questions and follow-ups). */
  respond: ConversationRespond | null
  /** Set on a missionary reply: who speaks after it. */
  next: ConversationReply['next'] | null
}

function options(answers: readonly (ConversationAnswer | string)[]): ResponseOption[] {
  return answers.map((answer, index) => (typeof answer === 'string' ? { id: answerId(index), text: answer } : answer))
}

export function findBeat(content: ConversationContent, id: string): Beat | null {
  const line = { respond: null, next: null, topicId: null }
  if (id === OPENING_ID) {
    const { opening } = content
    return {
      ...line,
      id,
      text: opening.text,
      caption: opening.caption,
      help: { greeting: true, prompt: opening.help.prompt, answers: options(opening.help.answers), passages: [] },
    }
  }
  if (id === CLARIFICATION_ID) {
    const { clarification } = content
    return {
      ...line,
      id,
      text: clarification.text,
      caption: clarification.caption,
      help: { greeting: false, hint: clarification.help.hint, answers: options(clarification.help.answers), passages: [] },
    }
  }
  if (id === CLOSING_ID) {
    return { ...line, id, text: content.closing.text, caption: content.closing.caption, help: null }
  }
  for (const topic of content.topics) {
    for (const item of [topic.question, ...topic.followUps]) {
      if (item.id === id) {
        return {
          id,
          text: item.text,
          caption: item.caption,
          help: {
            greeting: false,
            hint: item.help.hint,
            answers: options(item.help.answers),
            clarify: item.help.clarify,
            context: item.help.context,
            passages: item.help.passages ?? [],
          },
          topicId: topic.id,
          respond: item.respond ?? null,
          next: null,
        }
      }
      const reply = item.respond?.replies.find((candidate) => candidate.id === id)
      if (reply) {
        return {
          ...line,
          id,
          text: reply.text,
          caption: `Reply · ${topic.title}`,
          help: reply.help ? { greeting: false, hint: reply.help.hint, answers: reply.help.answers, passages: [] } : null,
          next: reply.next,
        }
      }
    }
  }
  return null
}

/** The Christian's reply options for a beat, in order, with the ids the server accepts. */
export function responseOptions(content: ConversationContent, beat: Beat): ResponseOption[] {
  const answers = (beat.help?.answers ?? []).map(({ id, text }) => ({ id, text }))
  if (beat.id === OPENING_ID) return answers
  return [...answers, { id: NOT_SURE_ID, text: content.notSureAnswer }]
}

/** The text of a Christian response, or null for the free marker or an unknown id. */
export function responseText(content: ConversationContent, beat: Beat | null, id: string): string | null {
  if (!beat || id === FREE_RESPONSE_ID) return null
  if (id === NOT_SURE_ID) return content.notSureAnswer
  if (id === CLARIFICATION_ID) return beat.help?.clarify ?? null
  return beat.help?.answers.find((answer) => answer.id === id)?.text ?? null
}

export const FREE_RESPONSE_TEXT = 'Answered aloud'
const FREE_RESPONSE_CAPTION = 'Spoken response · not transcribed'
export const OWN_WORDS_TEXT = 'Responded aloud'
const OWN_WORDS_CAPTION = 'Spoken reply · not transcribed'
const SUGGESTED_RESPONSE_CAPTION = 'Suggested response · confirmed aloud'

/** The shared thread, rebuilt from history. Unknown ids are skipped rather than guessed. */
export function threadMessages(content: ConversationContent, history: readonly HistoryEntry[]): ThreadMessage[] {
  const messages: ThreadMessage[] = []
  let lastBeat: Beat | null = null
  for (const entry of history) {
    if (entry.speaker === 'missionary') {
      if (entry.id === OWN_WORDS_ID) {
        lastBeat = null
        messages.push({ speaker: 'missionary', text: OWN_WORDS_TEXT, caption: OWN_WORDS_CAPTION, free: true })
        continue
      }
      lastBeat = findBeat(content, entry.id)
      if (lastBeat) messages.push({ speaker: 'missionary', text: lastBeat.text, caption: lastBeat.caption, free: false })
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
  /** The missionary owes a reply to the Christian's last answer (3.1). */
  responding: Responding | null
  /** The missionary just replied and now chooses how to continue. */
  afterReply: boolean
}

export interface Responding {
  /** The question or follow-up whose replies apply. */
  parent: Beat & { respond: ConversationRespond }
  /** The authored reply to the answer the Christian confirmed; null after a free answer or a clarification. */
  matchedId: string | null
}

function matchedReply(beat: Beat & { respond: ConversationRespond }, responseId: string): string | null {
  if (responseId === FREE_RESPONSE_ID) return null
  if (responseId === NOT_SURE_ID) return beat.respond.notSureReply
  if (responseId === CLARIFICATION_ID) return beat.respond.clarifyReply ?? null
  return beat.help?.answers.find((answer) => answer.id === responseId)?.reply ?? null
}

const hasReplies = (beat: Beat | null): beat is Beat & { respond: ConversationRespond } => !!beat?.respond

/**
 * Mirrors app_private.conversation_reply_parent: after the Christian answers a
 * question or follow-up with replies, the missionary responds to it. After
 * they answer the clarification or a reply that asked them something, the
 * missionary responds to the topic line before it, without an automatic match.
 */
function respondingTo(content: ConversationContent, history: readonly HistoryEntry[]): Responding | null {
  const last = history.at(-1)
  const asked = history.at(-2)
  if (last?.speaker !== 'christian' || asked?.speaker !== 'missionary' || asked.id === OPENING_ID) return null
  const askedBeat = findBeat(content, asked.id)
  if (askedBeat?.topicId) return hasReplies(askedBeat) ? { parent: askedBeat, matchedId: matchedReply(askedBeat, last.id) } : null
  for (let i = history.length - 3; i >= 0; i--) {
    if (history[i].speaker !== 'missionary') continue
    const beat = findBeat(content, history[i].id)
    if (beat?.topicId) return hasReplies(beat) ? { parent: beat, matchedId: null } : null
  }
  return null
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
  const lastBeat = last ? findBeat(content, last) : null
  const lastEntry = history.at(-1)
  return {
    started: spoken.length > 0,
    spoken,
    lastBeat,
    activeTopicId,
    askedTopicIds,
    responding: respondingTo(content, history),
    afterReply: lastEntry?.speaker === 'missionary' && (lastEntry.id === OWN_WORDS_ID || lastBeat?.next === 'continue'),
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
 * The missionary's next suggested line: the introduction, then the reply
 * matched to the Christian's answer, then the next follow-up in the active
 * topic, then the next topic not yet asked. Null when there is no match to a
 * free answer, and once every topic is exhausted, when only the closing remains.
 */
export function suggestNext(content: ConversationContent, progress: ConversationProgress): string | null {
  if (!progress.started) return OPENING_ID
  if (progress.responding) return progress.responding.matchedId
  const { continueTopic, otherDirections } = directionChoices(content, progress)
  return continueTopic[0]?.beatId ?? otherDirections[0]?.beatId ?? null
}

/** Whether the missionary may speak this line next; mirrors commit_utterance. */
export function canSpeak(content: ConversationContent, progress: ConversationProgress, id: string): boolean {
  if (!progress.started) return id === OPENING_ID
  if (id === CLOSING_ID) return true
  if (progress.responding) {
    // A reply to the parent line, a reply in their own words, or the clarification.
    if (id === FREE_RESPONSE_ID) return true
    if (id === CLARIFICATION_ID) return progress.spoken.at(-1) !== CLARIFICATION_ID
    return progress.responding.parent.respond.replies.some((reply) => reply.id === id)
  }
  if (id === CLARIFICATION_ID) return progress.activeTopicId !== null && progress.spoken.at(-1) !== CLARIFICATION_ID
  if (progress.spoken.includes(id)) return false
  if (content.topics.some((topic) => topic.question.id === id)) return true
  const beat = findBeat(content, id)
  return !!beat?.topicId && beat.topicId === progress.activeTopicId
}
