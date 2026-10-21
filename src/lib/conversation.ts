import { z } from 'zod'
import { referencedPassages } from './richText'
import { identifier, plainText, richText } from './schemaPrimitives'

/**
 * Conversation scenarios (schema 3.0): a spoken doorstep conversation with a
 * shared history. The missionary asks prepared questions and the Christian
 * answers each one. Each person prepares their next line privately; the send
 * button commits one authored beat (or, for the Christian, a free spoken
 * answer) to the shared history.
 *
 * The clarification, "not sure", and per-beat clarifying questions are
 * optional: leave them out where the missionary has no prepared answer.
 *
 * Schema 3.1 adds two-sided support: every suggested Christian answer to a
 * question or follow-up has a stable id, and a beat may carry `respond`, the
 * missionary's authored replies to what the Christian said.
 */
export const CONVERSATION_SCHEMA_VERSIONS = ['3.0', '3.1'] as const
export const REPLY_SCHEMA_VERSION = '3.1'

/** Fixed ids for the beats every conversation has. */
export const OPENING_ID = 'introduction'
export const CLARIFICATION_ID = 'clarify'
export const CLOSING_ID = 'closing'
/** Committed when someone spoke in their own words; history never holds free text. */
export const OWN_WORDS_ID = 'free'
export const NOT_SURE_ID = 'not-sure'

const beatId = identifier.max(40)

/** A 3.1 suggested answer: the id the server stores, and the missionary reply it leads to. */
const answerSchema = z
  .object({
    id: beatId,
    text: richText(700),
    reply: beatId.optional(),
  })
  .strict()

const replySchema = z
  .object({
    id: beatId,
    /** Short choice title, e.g. "Explain who Jesus is to us". */
    label: plainText(60),
    /** What the missionary says aloud. */
    text: richText(500),
    /**
     * `continue`: the missionary goes on to choose what to ask next.
     * `christian-response`: the reply asks something, so the Christian answers it.
     */
    next: z.enum(['continue', 'christian-response']),
    /** Christian help for a reply that hands the turn over. */
    help: z
      .object({
        hint: plainText(400),
        answers: z.array(z.object({ id: beatId, text: richText(700) }).strict()).min(1).max(4),
      })
      .strict()
      .optional(),
  })
  .strict()

/** The missionary's replies to the Christian's answer to one question or follow-up. */
const respondSchema = z
  .object({
    replies: z.array(replySchema).min(1).max(8),
    /** "What did your partner say?": short labels for an answer given in their own words. */
    heard: z.array(z.object({ label: plainText(60), reply: beatId }).strict()).min(2).max(3),
    /** The reply to the beat's clarifying question; required when the beat offers one. */
    clarifyReply: beatId.optional(),
    /** The reply to "I’m not sure yet"; required when the scenario offers it. */
    notSureReply: beatId.optional(),
  })
  .strict()

const httpsUrl = z
  .string()
  .max(400)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Use an https link')

/** Christian help for one missionary beat. */
const beatHelpSchema = z
  .object({
    /** "A starting point". */
    hint: plainText(400),
    /** Suggested replies the Christian can choose and say aloud; objects with ids in 3.1. */
    answers: z.array(z.union([richText(700), answerSchema])).min(1).max(4),
    /** A clarifying question the Christian can ask instead. */
    clarify: richText(300).optional(),
    /** Evangelical reading context, shown with the passages. */
    context: plainText(600).optional(),
    passages: z.array(identifier).min(1).max(8).optional(),
    /** Why the exchange matters, shown only when the Christian asks for it. */
    note: plainText(600).optional(),
    /** A short panel on what the sources say, under its own heading. */
    evidence: z.object({ heading: plainText(60), text: plainText(400), context: plainText(400).optional() }).strict().optional(),
    /** A reading the Christian can open or point their partner to. */
    reading: z.object({ label: plainText(80), url: httpsUrl }).strict().optional(),
  })
  .strict()

const beatSchema = z
  .object({
    id: beatId,
    /** What the missionary says aloud. */
    text: richText(700),
    /** The small line under the spoken message, e.g. "John 14:6 · KJV". */
    caption: plainText(80),
    /** A passage the caption names but the line doesn't quote; the caption opens it on both phones. */
    passage: identifier.optional(),
    help: beatHelpSchema,
    /** 3.1 only. Without it, the missionary goes straight on to the next question. */
    respond: respondSchema.optional(),
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
    /** On the role card and pairing summary, e.g. "LDS Missionary". */
    label: plainText(40),
    /** Above each spoken message, e.g. "LDS Missionary". */
    speaker: plainText(30),
    description: plainText(160),
  })
  .strict()

const resourceSchema = z
  .object({
    title: plainText(80),
    format: z.enum(['PDF', 'Article']),
    url: httpsUrl,
  })
  .strict()

const passageSchema = z
  .object({
    id: identifier,
    /** Exactly as shown, e.g. "John 14:1–6". */
    label: plainText(60),
    /** Where the text comes from when it isn't the scenario's translation, e.g. "Book of Mormon". */
    source: plainText(40).optional(),
    /** Reading context for the Christian; the missionary sees a neutral note. */
    context: plainText(600),
    verses: z
      .array(z.object({ number: z.number().int().positive(), text: plainText(1000) }).strict())
      .min(1)
      .max(60),
  })
  .strict()

const contentShape = {
  schemaVersion: z.enum(CONVERSATION_SCHEMA_VERSIONS),
  id: identifier,
  version: z.number().int().positive(),
  title: plainText(80),
  /**
   * For scenarios whose missionary lines are mostly statements: both send
   * buttons read "Speak aloud", the instructions say when to tap it, and the
   * missionary chooses lines rather than questions.
   */
  speakAloud: z.boolean().optional(),
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
    .strict()
    .optional(),
  /** Offered with every suggested-response list after the introduction. */
  notSureAnswer: plainText(200).optional(),
  closing: z.object({ id: z.literal(CLOSING_ID), text: richText(400), caption: plainText(80) }).strict(),
  reflection: z.object({ prompts: z.array(plainText(200)).min(1).max(5) }).strict(),
  /** A harder scenario the pair can move into together from the reflection screen, keeping their roles. */
  hardMode: z.object({ scenarioId: identifier }).strict().optional(),
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
    item.help.answers.forEach((answer, i) =>
      typeof answer === 'string'
        ? add([...path, 'help', 'answers', i], answer)
        : add([...path, 'help', 'answers', i, 'text'], answer.text),
    )
    add([...path, 'help', 'clarify'], item.help.clarify)
    item.respond?.replies.forEach((reply, r) => {
      const replyPath = [...path, 'respond', 'replies', r]
      add([...replyPath, 'text'], reply.text)
      reply.help?.answers.forEach((answer, i) => add([...replyPath, 'help', 'answers', i, 'text'], answer.text))
    })
  }
  scenario.topics.forEach((topic, t) => {
    beat(['topics', t, 'question'], topic.question)
    topic.followUps.forEach((followUp, f) => beat(['topics', t, 'followUps', f], followUp))
  })
  add(['clarification', 'text'], scenario.clarification?.text)
  scenario.clarification?.help.answers.forEach((answer, i) => add(['clarification', 'help', 'answers', i], answer))
  add(['closing', 'text'], scenario.closing.text)
  return fields
}

function checkConversation(scenario: ParsedConversation, ctx: z.RefinementCtx) {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })

  // Beat, answer, and reply ids are what the server stores and validates, so they must be unique.
  const ids = new Set<string>([OPENING_ID, CLARIFICATION_ID, CLOSING_ID, OWN_WORDS_ID, NOT_SURE_ID])
  const claim = (id: string, path: (string | number)[]) => {
    if (/^answer-\d+$/.test(id)) issue(`"${id}" is reserved for positional answers`, path)
    else if (ids.has(id)) issue(`Duplicate id "${id}"`, path)
    ids.add(id)
  }
  const replyVersion = scenario.schemaVersion === REPLY_SCHEMA_VERSION

  const checkResponses = (item: z.infer<typeof beatSchema>, path: (string | number)[]) => {
    const answersPath = [...path, 'help', 'answers']
    if (!replyVersion) {
      if (item.help.answers.some((answer) => typeof answer !== 'string')) {
        issue(`Answer ids need schemaVersion "${REPLY_SCHEMA_VERSION}"`, answersPath)
      }
      if (item.respond) issue(`Reply support needs schemaVersion "${REPLY_SCHEMA_VERSION}"`, [...path, 'respond'])
      return
    }
    item.help.answers.forEach((answer, i) => {
      if (typeof answer === 'string') issue('Give each answer an id', [...answersPath, i])
      else claim(answer.id, [...answersPath, i, 'id'])
    })
    const { respond } = item
    if (!respond) {
      item.help.answers.forEach((answer, i) => {
        if (typeof answer !== 'string' && answer.reply) issue('This beat has no replies to map to', [...answersPath, i, 'reply'])
      })
      return
    }

    const respondPath = [...path, 'respond']
    const replies = new Set<string>()
    respond.replies.forEach((reply, r) => {
      const replyPath = [...respondPath, 'replies', r]
      claim(reply.id, [...replyPath, 'id'])
      replies.add(reply.id)
      if (reply.next === 'christian-response' && !reply.help) {
        issue('A reply that hands the turn over needs Christian help', [...replyPath, 'help'])
      }
      if (reply.next === 'continue' && reply.help) issue('Only a reply that hands the turn over has Christian help', [...replyPath, 'help'])
      reply.help?.answers.forEach((answer, i) => claim(answer.id, [...replyPath, 'help', 'answers', i, 'id']))
    })
    const known = (id: string, at: (string | number)[]) => {
      if (!replies.has(id)) issue(`Unknown reply "${id}"`, at)
    }
    item.help.answers.forEach((answer, i) => {
      if (typeof answer === 'string') return
      if (answer.reply) known(answer.reply, [...answersPath, i, 'reply'])
      else issue('Map each answer to a reply', [...answersPath, i, 'reply'])
    })
    if (item.help.clarify && !respond.clarifyReply) issue('Map the clarifying question to a reply', [...respondPath, 'clarifyReply'])
    if (respond.clarifyReply) {
      if (item.help.clarify) known(respond.clarifyReply, [...respondPath, 'clarifyReply'])
      else issue('This beat has no clarifying question', [...respondPath, 'clarifyReply'])
    }
    if (scenario.notSureAnswer && !respond.notSureReply) issue('Map "not sure" to a reply', [...respondPath, 'notSureReply'])
    if (respond.notSureReply) {
      if (scenario.notSureAnswer) known(respond.notSureReply, [...respondPath, 'notSureReply'])
      else issue('This scenario has no "not sure" answer', [...respondPath, 'notSureReply'])
    }
    const heardReplies = new Set<string>()
    respond.heard.forEach((heard, i) => {
      known(heard.reply, [...respondPath, 'heard', i, 'reply'])
      if (heardReplies.has(heard.reply)) issue('Each heard label needs its own reply', [...respondPath, 'heard', i, 'reply'])
      heardReplies.add(heard.reply)
    })
  }

  const topicIds = new Set<string>()
  scenario.topics.forEach((topic, t) => {
    if (topicIds.has(topic.id)) issue(`Duplicate topic id "${topic.id}"`, ['topics', t, 'id'])
    topicIds.add(topic.id)
    const items: [z.infer<typeof beatSchema>, (string | number)[]][] = [
      [topic.question, ['topics', t, 'question']],
      ...topic.followUps.map((f, i): [z.infer<typeof beatSchema>, (string | number)[]] => [f, ['topics', t, 'followUps', i]]),
    ]
    for (const [item, path] of items) {
      claim(item.id, [...path, 'id'])
      checkResponses(item, path)
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
    const captions: [(string | number)[], string | undefined][] = [
      [['topics', t, 'question', 'passage'], topic.question.passage],
      ...topic.followUps.map((f, i): [(string | number)[], string | undefined] => [['topics', t, 'followUps', i, 'passage'], f.passage]),
    ]
    for (const [path, id] of captions) {
      if (id && !passages.has(id)) issue(`Unknown passage "${id}"`, path)
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
export type ConversationAnswer = ConversationBeat['help']['answers'][number]
export type ConversationRespond = NonNullable<ConversationBeat['respond']>
export type ConversationReply = ConversationRespond['replies'][number]
export type ConversationPassage = ConversationContent['passages']['items'][number]

/** Soft limit: a spoken line longer than this validates but produces a warning. */
const LONG_LINE = 400

export function conversationWarnings(scenario: ParsedConversation): string[] {
  const warnings: string[] = []
  for (const topic of scenario.topics) {
    for (const beat of [topic.question, ...topic.followUps]) {
      if (beat.text.length > LONG_LINE) warnings.push(`beat "${beat.id}" is ${beat.text.length} characters`)
      if (scenario.schemaVersion !== REPLY_SCHEMA_VERSION) continue
      if (!beat.respond) {
        warnings.push(`beat "${beat.id}" has no reply support yet`)
        continue
      }
      const used = new Set([
        ...beat.help.answers.map((answer) => (typeof answer === 'string' ? undefined : answer.reply)),
        beat.respond.clarifyReply,
        beat.respond.notSureReply,
        ...beat.respond.heard.map((heard) => heard.reply),
      ])
      for (const reply of beat.respond.replies) {
        if (!used.has(reply.id)) warnings.push(`reply "${reply.id}" is never offered`)
      }
    }
  }
  return warnings
}
