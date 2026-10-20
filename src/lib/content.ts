import { z } from 'zod'

/** The only scenario JSON contract this app can render. */
export const SCENARIO_SCHEMA_VERSION = '2.0'

/** Shown on the completion screen when a scenario has no reflection prompt of its own. */
export const DEFAULT_REFLECTION_PROMPT = 'What helped the conversation feel welcoming?'

const identifier = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits, and single hyphens')

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(max)
    .refine((value) => !/[<>]/.test(value), 'Plain text only; angle brackets are not allowed')

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

const openingDialogueSchema = z
  .object({
    /** The missionary's suggested greeting. */
    script: plainText(500),
    /** What the Christian sees while listening. */
    listenerPrompt: plainText(200).optional(),
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
    prompt: plainText(500),
    /** One possible response, blurred until the Christian reveals it. */
    exampleAnswer: plainText(800),
    scriptures: z.array(plainText(60)).min(1).max(6).optional(),
  })
  .strict()

const conclusionSchema = z
  .object({
    /** The missionary's suggested closing line. */
    closingPrompt: plainText(300),
    reflectionPrompt: plainText(300).optional(),
  })
  .strict()

const contentShape = {
  schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION),
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
  /** Reviewer notes and sources. Stored, never shown to participants. */
  sourceNotes: z.string().max(2000).optional(),
}

function checkUniqueIds(scenario: { questions: z.infer<typeof questionSchema>[] }, ctx: z.RefinementCtx) {
  const questionIds = new Set<string>()
  scenario.questions.forEach((question, index) => {
    if (questionIds.has(question.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate question id "${question.id}"`, path: ['questions', index, 'id'] })
    }
    questionIds.add(question.id)
  })
}

/** Scenario content as stored in `scenario_registry.content` and rendered by the app. */
export const scenarioContentSchema = z.object(contentShape).strict().superRefine(checkUniqueIds)

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
  .superRefine(checkUniqueIds)

export type ScenarioContent = z.infer<typeof scenarioContentSchema>
export type ScenarioFile = z.infer<typeof scenarioFileSchema>
export type ScenarioQuestion = ScenarioContent['questions'][number]
export type QuestionIcon = (typeof QUESTION_ICONS)[number]
export type ScenarioRoleScene = ScenarioContent['roles']['missionary']
export type ScenarioImage = NonNullable<ScenarioRoleScene['image']>

/** Strips file-only fields, leaving exactly what is stored and rendered. */
export function toStoredContent(file: ScenarioFile): ScenarioContent {
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
  const valid: ScenarioFile[] = []

  files.forEach((raw, index) => {
    const result = scenarioFileSchema.safeParse(raw)
    const name = describe(raw, index)
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
