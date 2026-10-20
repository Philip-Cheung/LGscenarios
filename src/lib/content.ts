import { z } from 'zod'

/** The only scenario JSON contract this app can render. */
export const SCENARIO_SCHEMA_VERSION = '1.0'

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

const role = z.enum(['missionary', 'christian'])

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
    image: imageSchema.optional(),
  })
  .strict()

const interactionTriggerSchema = z
  .object({
    initiatingRole: role,
    initiatorPrompt: plainText(200),
    initiatorActionLabel: plainText(40),
    receiverPrompt: plainText(200),
    receiverActionLabel: plainText(40),
  })
  .strict()

const openingDialogueSchema = z
  .object({
    speakerRole: role,
    script: plainText(500),
    listenerPrompt: plainText(200).optional(),
  })
  .strict()

const christianHelpSchema = z
  .object({
    hint: plainText(240).optional(),
    scriptures: z.array(plainText(60)).min(1).max(6).optional(),
    hiddenAnswer: plainText(800),
  })
  .strict()

const followUpSchema = z
  .object({
    id: identifier.max(40),
    label: plainText(60).optional(),
    missionaryScript: plainText(500),
    christian: christianHelpSchema,
  })
  .strict()

const questionSchema = z
  .object({
    id: identifier.max(40),
    title: plainText(80),
    topicTag: plainText(40).optional(),
    missionaryScript: plainText(500),
    christian: christianHelpSchema,
    followUps: z.array(followUpSchema).max(6).optional(),
  })
  .strict()

const conclusionSchema = z
  .object({
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
  roles: z.object({ missionary: roleSceneSchema, christian: roleSceneSchema }).strict(),
  interactionTrigger: interactionTriggerSchema,
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
    const followUpIds = new Set<string>()
    question.followUps?.forEach((followUp, followUpIndex) => {
      if (followUpIds.has(followUp.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate follow-up id "${followUp.id}"`,
          path: ['questions', index, 'followUps', followUpIndex, 'id'],
        })
      }
      followUpIds.add(followUp.id)
    })
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
export type ScenarioFollowUp = NonNullable<ScenarioQuestion['followUps']>[number]
export type ChristianHelp = ScenarioQuestion['christian']
export type ScenarioRoleScene = ScenarioContent['roles']['missionary']
export type ScenarioImage = NonNullable<ScenarioRoleScene['image']>

/** Strips file-only fields, leaving exactly what is stored and rendered. */
export function toStoredContent(file: ScenarioFile): ScenarioContent {
  const { $schema: _schema, status: _status, ...content } = file
  return content
}

/** The question and optional follow-up the pair is currently discussing. */
export function findDiscussionItem(
  scenario: ScenarioContent,
  questionId: string | null,
  followUpId: string | null,
): { question: ScenarioQuestion; followUp: ScenarioFollowUp | null } | null {
  const question = scenario.questions.find((item) => item.id === questionId)
  if (!question) return null
  if (!followUpId) return { question, followUp: null }
  const followUp = question.followUps?.find((item) => item.id === followUpId)
  return followUp ? { question, followUp } : null
}

/** Soft limits: content above these validates but produces a warning. */
export const CONTENT_WARNING_LIMITS = {
  title: 60,
  sceneText: 280,
  script: 240,
  hiddenAnswer: 360,
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
      const items: { label: string; item: Pick<ScenarioFollowUp, 'missionaryScript' | 'christian'> }[] = [
        { label: `question "${question.id}"`, item: question },
        ...(question.followUps ?? []).map((followUp) => ({
          label: `follow-up "${question.id}/${followUp.id}"`,
          item: followUp,
        })),
      ]
      for (const { label, item } of items) {
        if (item.missionaryScript.length > CONTENT_WARNING_LIMITS.script) {
          warnings.push(`${name}: ${label} script is ${item.missionaryScript.length} characters`)
        }
        if (item.christian.hiddenAnswer.length > CONTENT_WARNING_LIMITS.hiddenAnswer) {
          warnings.push(`${name}: ${label} hidden answer is ${item.christian.hiddenAnswer.length} characters`)
        }
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
