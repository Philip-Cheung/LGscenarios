import { z } from 'zod'
import {
  CONVERSATION_SCHEMA_VERSIONS,
  conversationContentSchema,
  conversationFileSchema,
  conversationWarnings,
  type ConversationContent,
  type ConversationFile,
} from './conversation'
import { referencedPassages } from './richText'
import { identifier, plainText, richText } from './schemaPrimitives'

/** Guided scenario JSON contracts. 2.1 adds opening questions, follow-ups, help, and Bible passages. */
export const SCENARIO_SCHEMA_VERSIONS = ['2.0', '2.1'] as const

/** Every scenario JSON contract this app can render, including conversation scenarios (3.x). */
export const ALL_SCENARIO_SCHEMA_VERSIONS = [...SCENARIO_SCHEMA_VERSIONS, ...CONVERSATION_SCHEMA_VERSIONS] as const

/** Shown on the completion screen when a scenario has no reflection prompt of its own. */
export const DEFAULT_REFLECTION_PROMPT = 'What helped the conversation feel welcoming?'

/** A collapsible block of extra help: reasoning, Bible context, or a fallback line. */
const helpSectionSchema = z
  .object({
    heading: plainText(60).optional(),
    text: richText(1200),
  })
  .strict()

const moreHelpSchema = z.array(helpSectionSchema).min(1).max(8)

/** A file in the public `scenario-images` storage bucket, e.g. `who-is-god/door.jpg`. */
const imageSchema = z
  .object({
    path: z
      .string()
      .max(160)
      .regex(
        /^[a-z0-9]+([-_][a-z0-9]+)*(\/[a-z0-9]+([-_][a-z0-9]+)*)*\.(jpg|jpeg|png|webp)$/,
        'Use a lowercase bucket path ending in .jpg, .jpeg, .png, or .webp',
      ),
    alt: plainText(160),
  })
  .strict()

const roleSceneSchema = z
  .object({
    label: plainText(40),
    sceneTitle: plainText(80),
    sceneText: plainText(400),
    goal: plainText(200),
    /** Replaces the scenario illustration for this role's scene. */
    image: imageSchema.optional(),
  })
  .strict()

/** A required question inside the opening; the Christian answers before topics unlock. */
const openingQuestionSchema = z
  .object({
    prompt: richText(300),
    /** Shown to the missionary between the greeting and the question. */
    missionaryNote: plainText(300).optional(),
    exampleAnswer: richText(800),
    moreHelp: moreHelpSchema.optional(),
    /** The missionary's suggested reply, shown once above the first topic list. */
    acknowledgment: plainText(300),
  })
  .strict()

const openingDialogueSchema = z
  .object({
    /** The missionary's suggested greeting. */
    script: plainText(500),
    /** A short note for the missionary under the greeting. */
    scriptNote: plainText(200).optional(),
    /** What the Christian sees while listening. */
    listenerPrompt: plainText(200).optional(),
    question: openingQuestionSchema.optional(),
  })
  .strict()

/** The missionary's challenge after the Christian's first answer, and the Christian's reply. */
const followUpSchema = z
  .object({
    prompt: richText(700),
    /** Brief coaching shown with the prompt, e.g. how to adapt it. */
    missionaryNote: plainText(300).optional(),
    /** Optional alternate wording for the missionary, collapsed by default. */
    missionaryHelp: moreHelpSchema.optional(),
    exampleAnswer: richText(900),
    moreHelp: moreHelpSchema.optional(),
  })
  .strict()

/** Built-in icons for question options. */
export const QUESTION_ICONS = ['chat', 'leaf', 'book'] as const

const questionSchema = z
  .object({
    id: identifier.max(40),
    /** Short label above the question, e.g. "Hope". */
    topic: plainText(40),
    icon: z.enum(QUESTION_ICONS).optional(),
    /** The question the missionary asks aloud; the Christian sees it after it is asked. */
    prompt: richText(700),
    /** One possible response, blurred until the Christian reveals it. */
    exampleAnswer: richText(800),
    /** Collapsed under the revealed example. */
    moreHelp: moreHelpSchema.optional(),
    scriptures: z.array(plainText(60)).min(1).max(6).optional(),
    followUp: followUpSchema.optional(),
  })
  .strict()

const conclusionSchema = z
  .object({
    /** The missionary's suggested closing line. */
    closingPrompt: plainText(300),
    /** An optional reply the Christian can give while the missionary closes. */
    listenerReply: plainText(300).optional(),
    reflectionPrompt: plainText(300).optional(),
    /** A smaller second reflection under the main prompt. */
    reflectionFollowUp: plainText(300).optional(),
  })
  .strict()

const verseRangeShape = {
  start: z.number().int().positive(),
  end: z.number().int().positive(),
}

/** Verified Bible text bundled with the scenario, so passages open without a network call. */
const bibleSchema = z
  .object({
    translation: plainText(60),
    /** Where the text was verified; kept for attribution, not shown in the reader. */
    source: plainText(300).optional(),
    chapters: z
      .array(
        z
          .object({
            id: identifier,
            book: plainText(40),
            chapter: z.number().int().positive(),
            verses: z
              .array(z.object({ number: z.number().int().positive(), text: plainText(1000) }).strict())
              .min(1)
              .max(176),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    references: z
      .array(
        z
          .object({
            id: identifier,
            /** Exactly as shown on the reference, e.g. "James 1:5". */
            label: plainText(60),
            chapter: identifier,
            ...verseRangeShape,
            /** The surrounding verses "Read surrounding verses" expands to. */
            context: z.object(verseRangeShape).strict().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(80),
  })
  .strict()

const contentShape = {
  schemaVersion: z.enum(SCENARIO_SCHEMA_VERSIONS),
  id: identifier,
  version: z.number().int().positive(),
  title: plainText(80),
  subtitle: plainText(180).optional(),
  estimatedMinutes: z.number().int().min(1).max(120).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  /** Built-in scene illustration, used when a role has no image of its own. */
  illustration: z.enum(['doorway']).optional(),
  roles: z.object({ missionary: roleSceneSchema, christian: roleSceneSchema }).strict(),
  openingDialogue: openingDialogueSchema,
  questions: z.array(questionSchema).min(1).max(12),
  conclusion: conclusionSchema,
  bible: bibleSchema.optional(),
  /** Reviewer notes and sources. Stored, never shown to participants. */
  sourceNotes: z.string().max(4000).optional(),
}

type ParsedContent = z.infer<z.ZodObject<typeof contentShape>>

/** Every field that may contain passage references, with its path for error messages. */
export function richTextFields(scenario: ParsedContent): { path: (string | number)[]; text: string }[] {
  const fields: { path: (string | number)[]; text: string }[] = []
  const help = (path: (string | number)[], sections: { text: string }[] | undefined) =>
    sections?.forEach((section, index) => fields.push({ path: [...path, index, 'text'], text: section.text }))
  const opening = scenario.openingDialogue.question
  if (opening) {
    fields.push({ path: ['openingDialogue', 'question', 'prompt'], text: opening.prompt })
    fields.push({ path: ['openingDialogue', 'question', 'exampleAnswer'], text: opening.exampleAnswer })
    help(['openingDialogue', 'question', 'moreHelp'], opening.moreHelp)
  }
  scenario.questions.forEach((question, index) => {
    const base = ['questions', index]
    fields.push({ path: [...base, 'prompt'], text: question.prompt })
    fields.push({ path: [...base, 'exampleAnswer'], text: question.exampleAnswer })
    help([...base, 'moreHelp'], question.moreHelp)
    if (question.followUp) {
      fields.push({ path: [...base, 'followUp', 'prompt'], text: question.followUp.prompt })
      fields.push({ path: [...base, 'followUp', 'exampleAnswer'], text: question.followUp.exampleAnswer })
      help([...base, 'followUp', 'moreHelp'], question.followUp.moreHelp)
      help([...base, 'followUp', 'missionaryHelp'], question.followUp.missionaryHelp)
    }
  })
  return fields
}

function usesVersion21Fields(scenario: ParsedContent): boolean {
  return Boolean(
    scenario.bible ||
      scenario.openingDialogue.question ||
      scenario.openingDialogue.scriptNote ||
      scenario.conclusion.listenerReply ||
      scenario.conclusion.reflectionFollowUp ||
      scenario.questions.some((question) => question.followUp || question.moreHelp),
  )
}

function checkContent(scenario: ParsedContent, ctx: z.RefinementCtx) {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })

  const questionIds = new Set<string>()
  scenario.questions.forEach((question, index) => {
    if (questionIds.has(question.id)) issue(`Duplicate question id "${question.id}"`, ['questions', index, 'id'])
    questionIds.add(question.id)
  })

  if (scenario.schemaVersion === '2.0' && usesVersion21Fields(scenario)) {
    issue('Opening questions, follow-ups, help, and Bible passages need schemaVersion "2.1"', ['schemaVersion'])
  }

  // Every chapter, reference, and range must resolve to verified text.
  const chapters = new Map<string, Set<number>>()
  scenario.bible?.chapters.forEach((chapter, index) => {
    if (chapters.has(chapter.id)) issue(`Duplicate chapter id "${chapter.id}"`, ['bible', 'chapters', index, 'id'])
    const numbers = new Set<number>()
    chapter.verses.forEach((verse, verseIndex) => {
      if (numbers.has(verse.number)) {
        issue(`Duplicate verse ${verse.number}`, ['bible', 'chapters', index, 'verses', verseIndex, 'number'])
      }
      numbers.add(verse.number)
    })
    chapters.set(chapter.id, numbers)
  })
  const references = new Set<string>()
  scenario.bible?.references.forEach((reference, index) => {
    const path = ['bible', 'references', index]
    if (references.has(reference.id)) issue(`Duplicate reference id "${reference.id}"`, [...path, 'id'])
    references.add(reference.id)
    const verses = chapters.get(reference.chapter)
    if (!verses) {
      issue(`Unknown chapter "${reference.chapter}"`, [...path, 'chapter'])
      return
    }
    const covered = (start: number, end: number) => {
      for (let n = start; n <= end; n += 1) if (!verses.has(n)) return false
      return start <= end
    }
    if (!covered(reference.start, reference.end)) {
      issue(`Verses ${reference.start}-${reference.end} are not all in "${reference.chapter}"`, path)
    }
    const { context } = reference
    if (context) {
      if (context.start > reference.start || context.end < reference.end) {
        issue('Context must include the selected verses', [...path, 'context'])
      } else if (context.start === reference.start && context.end === reference.end) {
        issue('Context must add surrounding verses', [...path, 'context'])
      } else if (!covered(context.start, context.end)) {
        issue(`Context verses ${context.start}-${context.end} are not all in "${reference.chapter}"`, [...path, 'context'])
      }
    }
  })
  for (const field of richTextFields(scenario)) {
    for (const id of referencedPassages(field.text)) {
      if (!references.has(id)) issue(`Unknown Bible reference "${id}"`, field.path)
    }
  }
}

/** Scenario content as stored in `scenario_registry.content` and rendered by the app. */
export const scenarioContentSchema = z.object(contentShape).strict().superRefine(checkContent)

/**
 * A reviewed scenario file in `content/scenarios`. `status` decides whether
 * publishing stores it as a hidden draft or opens it to participants; it is
 * kept in the registry row, not in the stored content.
 */
export const scenarioFileSchema = z
  .object({
    $schema: z.string().optional(),
    status: z.enum(['draft', 'published']),
    ...contentShape,
  })
  .strict()
  .superRefine(checkContent)

export type ScenarioContent = z.infer<typeof scenarioContentSchema>
export type ScenarioFile = z.infer<typeof scenarioFileSchema>
export type ScenarioQuestion = ScenarioContent['questions'][number]
export type QuestionIcon = (typeof QUESTION_ICONS)[number]
export type ScenarioRoleScene = ScenarioContent['roles']['missionary']
export type ScenarioImage = NonNullable<ScenarioRoleScene['image']>
export type ScenarioHelpSection = z.infer<typeof helpSectionSchema>
export type ScenarioFollowUp = z.infer<typeof followUpSchema>
export type ScenarioOpeningQuestion = z.infer<typeof openingQuestionSchema>
export type ScenarioBible = z.infer<typeof bibleSchema>
export type BibleReference = ScenarioBible['references'][number]

/** A scenario of either kind: guided (2.x) or conversation (3.x). */
export type AnyScenarioContent = ScenarioContent | ConversationContent
export type AnyScenarioFile = ScenarioFile | ConversationFile

function declaresConversation(raw: unknown): boolean {
  const declared = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
  return (CONVERSATION_SCHEMA_VERSIONS as readonly unknown[]).includes(declared)
}

export function isConversation(scenario: AnyScenarioContent): scenario is ConversationContent {
  return declaresConversation(scenario)
}

type ParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError }

/** Stored registry content of either kind; the declared schemaVersion picks the contract. */
export function parseScenarioContent(raw: unknown): ParseResult<AnyScenarioContent> {
  return declaresConversation(raw) ? conversationContentSchema.safeParse(raw) : scenarioContentSchema.safeParse(raw)
}

/** A reviewed scenario file of either kind. */
export function parseScenarioFile(raw: unknown): ParseResult<AnyScenarioFile> {
  return declaresConversation(raw) ? conversationFileSchema.safeParse(raw) : scenarioFileSchema.safeParse(raw)
}

/** Source for content/scenario.schema.json, so editors check files of either kind. */
export const scenarioFileJsonSchemaSource = z.union([scenarioFileSchema, conversationFileSchema])

/** Questions in a guided scenario, topics in a conversation scenario. */
export function promptCount(scenario: AnyScenarioContent): number {
  return isConversation(scenario) ? scenario.topics.length : scenario.questions.length
}

/** Strips file-only fields, leaving exactly what is stored and rendered. */
export function toStoredContent(file: ScenarioFile): ScenarioContent
export function toStoredContent(file: ConversationFile): ConversationContent
export function toStoredContent(file: AnyScenarioFile): AnyScenarioContent
export function toStoredContent(file: AnyScenarioFile): AnyScenarioContent {
  const { $schema: _schema, status: _status, ...content } = file
  return content
}

export function findQuestion(scenario: ScenarioContent, questionId: string | null): ScenarioQuestion | null {
  return scenario.questions.find((item) => item.id === questionId) ?? null
}

/** Soft limits: content above these validates but produces a warning. */
export const CONTENT_WARNING_LIMITS = {
  title: 60,
  sceneText: 280,
  script: 240,
  exampleAnswer: 360,
} as const

export interface ContentReport {
  errors: string[]
  warnings: string[]
}

function describe(raw: unknown, index: number) {
  const value = (raw ?? {}) as Record<string, unknown>
  return typeof value.id === 'string' ? `${value.id} v${String(value.version)}` : `#${index}`
}

/** Validates a full set of scenario files, including cross-version rules. */
export function validateScenarioFiles(files: readonly unknown[]): ContentReport {
  const errors: string[] = []
  const warnings: string[] = []
  const valid: AnyScenarioFile[] = []

  files.forEach((raw, index) => {
    const name = describe(raw, index)
    if (declaresConversation(raw)) {
      const result = conversationFileSchema.safeParse(raw)
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push(`${name}: ${issue.path.join('.') || '(root)'} ${issue.message}`)
        }
        return
      }
      valid.push(result.data)
      for (const warning of conversationWarnings(result.data)) warnings.push(`${name}: ${warning}`)
      return
    }
    const result = scenarioFileSchema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${name}: ${issue.path.join('.') || '(root)'} ${issue.message}`)
      }
      return
    }
    const scenario = result.data
    valid.push(scenario)
    if (scenario.title.length > CONTENT_WARNING_LIMITS.title) {
      warnings.push(`${name}: title is ${scenario.title.length} characters`)
    }
    for (const roleName of ['missionary', 'christian'] as const) {
      const length = scenario.roles[roleName].sceneText.length
      if (length > CONTENT_WARNING_LIMITS.sceneText) warnings.push(`${name}: ${roleName} sceneText is ${length} characters`)
    }
    if (scenario.openingDialogue.script.length > CONTENT_WARNING_LIMITS.script) {
      warnings.push(`${name}: opening script is ${scenario.openingDialogue.script.length} characters`)
    }
    for (const question of scenario.questions) {
      if (question.prompt.length > CONTENT_WARNING_LIMITS.script) {
        warnings.push(`${name}: question "${question.id}" prompt is ${question.prompt.length} characters`)
      }
      if (question.exampleAnswer.length > CONTENT_WARNING_LIMITS.exampleAnswer) {
        warnings.push(`${name}: question "${question.id}" example answer is ${question.exampleAnswer.length} characters`)
      }
    }
  })

  const versionKeys = new Set<string>()
  for (const scenario of valid) {
    const key = `${scenario.id}@${scenario.version}`
    if (versionKeys.has(key)) errors.push(`Duplicate scenario version ${key}`)
    versionKeys.add(key)
  }

  return { errors, warnings }
}
