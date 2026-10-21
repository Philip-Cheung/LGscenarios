import { z } from 'zod'
import { referencedPassages } from './richText'
import { identifier, plainText, richText } from './schemaPrimitives'

/**
 * Conversation scenarios (schema 3.0): a spoken doorstep conversation with a
 * shared history. Each person prepares their next line privately; "Speak
 * aloud" commits one authored beat (or, for the Christian, a free spoken
 * reply) to the shared history.
 */
export const CONVERSATION_SCHEMA_VERSION = '3.0'

/** Fixed ids for the beats every conversation has. */
export const OPENING_ID = 'introduction'
export const CLARIFICATION_ID = 'clarify'
export const CLOSING_ID = 'closing'

const beatId = identifier.max(40)

/** Christian help for one missionary beat. */
const beatHelpSchema = z
  .object({
    /** "A starting point". */
    hint: plainText(400),
    /** Suggested replies the Christian can choose and say aloud. */
    answers: z.array(richText(700)).min(1).max(4),
    /** A clarifying question the Christian can ask instead. */
    clarify: richText(300).optional(),
    /** Evangelical reading context, shown with the passages. */
    context: plainText(600).optional(),
    passages: z.array(identifier).min(1).max(8).optional(),
  })
  .strict()

const beatSchema = z
  .object({
    id: beatId,
    /** What the missionary says aloud. */
    text: richText(700),
    /** The small line under the spoken message, e.g. "John 14:6 · KJV". */
    caption: plainText(80),
    help: beatHelpSchema,
  })
  .strict()

const followUpSchema = beatSchema
  .extend({
    /** Short choice title, e.g. "Would you call us Christians?". */
    title: plainText(60),
    /** One-line description under the title. */
    summary: plainText(120),
  })
  .strict()

const topicSchema = z
  .object({
    id: beatId,
    title: plainText(60),
    summary: plainText(120),
    /** Background for the missionary about this topic. */
    background: plainText(600),
    question: beatSchema,
    followUps: z.array(followUpSchema).max(4),
  })
  .strict()

const roleSchema = z
  .object({
    /** On the role card and pairing summary, e.g. "Mormon missionary". */
    label: plainText(40),
    /** Above each spoken message, e.g. "Missionary". */
    speaker: plainText(30),
    description: plainText(160),
  })
  .strict()

const resourceSchema = z
  .object({
    title: plainText(80),
    format: z.enum(['PDF', 'Article']),
    url: z
      .string()
      .max(400)
      .refine((value) => {
        try {
          return new URL(value).protocol === 'https:'
        } catch {
          return false
        }
      }, 'Use an https link'),
  })
  .strict()

const passageSchema = z
  .object({
    id: identifier,
    /** Exactly as shown, e.g. "John 14:1–6". */
    label: plainText(60),
    /** Reading context for the Christian; the missionary sees a neutral note. */
    context: plainText(600),
    verses: z
      .array(z.object({ number: z.number().int().positive(), text: plainText(1000) }).strict())
      .min(1)
      .max(60),
  })
  .strict()

const contentShape = {
  schemaVersion: z.literal(CONVERSATION_SCHEMA_VERSION),
  id: identifier,
  version: z.number().int().positive(),
  title: plainText(80),
  /** The role choice screen. */
  intro: z.object({ kicker: plainText(60), heading: plainText(80), description: plainText(300) }).strict(),
  roles: z.object({ missionary: roleSchema, christian: roleSchema }).strict(),
  resources: z
    .object({
      heading: plainText(60),
      /** Under the heading in the options sheet, e.g. "Weekly reading · Watchman Fellowship". */
      source: plainText(80),
      items: z.array(resourceSchema).min(1).max(8),
    })
    .strict(),
  opening: z
    .object({
      id: z.literal(OPENING_ID),
      text: richText(500),
      caption: plainText(80),
      help: z
        .object({ prompt: plainText(200), answers: z.array(richText(400)).min(1).max(4) })
        .strict(),
    })
    .strict(),
  topics: z.array(topicSchema).min(1).max(8),
  /** "Ask them to explain": available to the missionary while a topic is active. */
  clarification: z
    .object({
      id: z.literal(CLARIFICATION_ID),
      text: richText(300),
      caption: plainText(80),
      help: z.object({ hint: plainText(400), answers: z.array(richText(400)).min(1).max(4) }).strict(),
    })
    .strict(),
  /** Offered with every suggested-response list after the introduction. */
  notSureAnswer: plainText(200),
  closing: z.object({ id: z.literal(CLOSING_ID), text: richText(400), caption: plainText(80) }).strict(),
  reflection: z.object({ prompts: z.array(plainText(200)).min(1).max(5) }).strict(),
  passages: z.object({ translation: plainText(60), items: z.array(passageSchema).min(1).max(40) }).strict(),
  /** Reviewer notes and sources. Stored, never shown to participants. */
  sourceNotes: z.string().max(4000).optional(),
}

type ParsedConversation = z.infer<z.ZodObject<typeof contentShape>>

/** Every field that may contain passage references, with its path for error messages. */
function richFields(scenario: ParsedConversation): { path: (string | number)[]; text: string }[] {
  const fields: { path: (string | number)[]; text: string }[] = []
  const add = (path: (string | number)[], text: string | undefined) => {
    if (text) fields.push({ path, text })
  }
  add(['opening', 'text'], scenario.opening.text)
  scenario.opening.help.answers.forEach((answer, i) => add(['opening', 'help', 'answers', i], answer))
  const beat = (path: (string | number)[], item: z.infer<typeof beatSchema>) => {
    add([...path, 'text'], item.text)
    item.help.answers.forEach((answer, i) => add([...path, 'help', 'answers', i], answer))
    add([...path, 'help', 'clarify'], item.help.clarify)
  }
  scenario.topics.forEach((topic, t) => {
    beat(['topics', t, 'question'], topic.question)
    topic.followUps.forEach((followUp, f) => beat(['topics', t, 'followUps', f], followUp))
  })
  add(['clarification', 'text'], scenario.clarification.text)
  scenario.clarification.help.answers.forEach((answer, i) => add(['clarification', 'help', 'answers', i], answer))
  add(['closing', 'text'], scenario.closing.text)
  return fields
}

function checkConversation(scenario: ParsedConversation, ctx: z.RefinementCtx) {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })

  // Beat ids are what the server stores and validates, so they must be unique.
  const beats = new Set<string>([OPENING_ID, CLARIFICATION_ID, CLOSING_ID])
  const topicIds = new Set<string>()
  scenario.topics.forEach((topic, t) => {
    if (topicIds.has(topic.id)) issue(`Duplicate topic id "${topic.id}"`, ['topics', t, 'id'])
    topicIds.add(topic.id)
    const items: [string, (string | number)[]][] = [
      [topic.question.id, ['topics', t, 'question', 'id']],
      ...topic.followUps.map((f, i): [string, (string | number)[]] => [f.id, ['topics', t, 'followUps', i, 'id']]),
    ]
    for (const [id, path] of items) {
      if (beats.has(id)) issue(`Duplicate beat id "${id}"`, path)
      beats.add(id)
    }
  })

  const passages = new Set<string>()
  scenario.passages.items.forEach((passage, p) => {
    if (passages.has(passage.id)) issue(`Duplicate passage id "${passage.id}"`, ['passages', 'items', p, 'id'])
    passages.add(passage.id)
    passage.verses.forEach((verse, v) => {
      if (v > 0 && verse.number <= passage.verses[v - 1].number) {
        issue('Verse numbers must increase', ['passages', 'items', p, 'verses', v, 'number'])
      }
    })
  })

  for (const field of richFields(scenario)) {
    for (const id of referencedPassages(field.text)) {
      if (!passages.has(id)) issue(`Unknown passage "${id}"`, field.path)
    }
  }
  scenario.topics.forEach((topic, t) => {
    const lists: [(string | number)[], string[] | undefined][] = [
      [['topics', t, 'question', 'help', 'passages'], topic.question.help.passages],
      ...topic.followUps.map((f, i): [(string | number)[], string[] | undefined] => [
        ['topics', t, 'followUps', i, 'help', 'passages'],
        f.help.passages,
      ]),
    ]
    for (const [path, list] of lists) {
      list?.forEach((id, i) => {
        if (!passages.has(id)) issue(`Unknown passage "${id}"`, [...path, i])
      })
    }
  })
}

export const conversationContentSchema = z.object(contentShape).strict().superRefine(checkConversation)

export const conversationFileSchema = z
  .object({
    $schema: z.string().optional(),
    status: z.enum(['draft', 'published']),
    ...contentShape,
  })
  .strict()
  .superRefine(checkConversation)

export type ConversationContent = z.infer<typeof conversationContentSchema>
export type ConversationFile = z.infer<typeof conversationFileSchema>
export type ConversationTopic = ConversationContent['topics'][number]
export type ConversationFollowUp = ConversationTopic['followUps'][number]
export type ConversationBeat = ConversationTopic['question']
export type ConversationPassage = ConversationContent['passages']['items'][number]

/** Soft limit: a spoken line longer than this validates but produces a warning. */
const LONG_LINE = 400

export function conversationWarnings(scenario: ParsedConversation): string[] {
  const warnings: string[] = []
  for (const topic of scenario.topics) {
    for (const beat of [topic.question, ...topic.followUps]) {
      if (beat.text.length > LONG_LINE) warnings.push(`beat "${beat.id}" is ${beat.text.length} characters`)
    }
  }
  return warnings
}
