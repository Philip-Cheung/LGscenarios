import { z } from 'zod'

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

export const promptSchema = z
  .object({
    id: identifier.max(40),
    label: plainText(60),
    text: plainText(400),
    suggestedAnswer: plainText(600),
    scriptureReference: plainText(80).optional(),
  })
  .strict()

export const scenarioSchema = z
  .object({
    scenarioId: identifier,
    slug: identifier,
    version: z.number().int().positive(),
    title: plainText(80),
    prompts: z.array(promptSchema).min(1).max(200),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const seen = new Set<string>()
    scenario.prompts.forEach((prompt, index) => {
      if (seen.has(prompt.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate prompt id "${prompt.id}"`, path: ['prompts', index, 'id'] })
      }
      seen.add(prompt.id)
    })
  })

export type ScenarioPrompt = z.infer<typeof promptSchema>
export type ScenarioContent = z.infer<typeof scenarioSchema>

/** Soft limits: content above these validates but produces a warning. */
export const CONTENT_WARNING_LIMITS = {
  title: 60,
  label: 40,
  text: 180,
  suggestedAnswer: 240,
} as const

export interface ContentReport {
  errors: string[]
  warnings: string[]
}

function describe(scenario: { scenarioId?: unknown; version?: unknown }, index: number) {
  return typeof scenario.scenarioId === 'string' ? `${scenario.scenarioId} v${String(scenario.version)}` : `#${index}`
}

/** Validates a full set of scenario versions, including cross-version rules. */
export function validateScenarioSet(scenarios: readonly unknown[]): ContentReport {
  const errors: string[] = []
  const warnings: string[] = []
  const valid: ScenarioContent[] = []

  scenarios.forEach((raw, index) => {
    const result = scenarioSchema.safeParse(raw)
    const name = describe((raw ?? {}) as Record<string, unknown>, index)
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
    for (const prompt of scenario.prompts) {
      for (const field of ['label', 'text', 'suggestedAnswer'] as const) {
        if (prompt[field].length > CONTENT_WARNING_LIMITS[field]) {
          warnings.push(`${name}: prompt "${prompt.id}" ${field} is ${prompt[field].length} characters`)
        }
      }
    }
  })

  const versionKeys = new Set<string>()
  const slugVersionKeys = new Set<string>()
  const slugToScenario = new Map<string, string>()
  const scenarioToSlug = new Map<string, string>()
  for (const scenario of valid) {
    const versionKey = `${scenario.scenarioId}@${scenario.version}`
    if (versionKeys.has(versionKey)) errors.push(`Duplicate scenario version ${versionKey}`)
    versionKeys.add(versionKey)

    const slugVersionKey = `${scenario.slug}@${scenario.version}`
    if (slugVersionKeys.has(slugVersionKey)) errors.push(`Duplicate slug version ${slugVersionKey}`)
    slugVersionKeys.add(slugVersionKey)

    const mappedScenario = slugToScenario.get(scenario.slug)
    if (mappedScenario && mappedScenario !== scenario.scenarioId) {
      errors.push(`Slug "${scenario.slug}" is used by both ${mappedScenario} and ${scenario.scenarioId}`)
    }
    slugToScenario.set(scenario.slug, scenario.scenarioId)

    const mappedSlug = scenarioToSlug.get(scenario.scenarioId)
    if (mappedSlug && mappedSlug !== scenario.slug) {
      errors.push(`Scenario ${scenario.scenarioId} uses both slugs "${mappedSlug}" and "${scenario.slug}"`)
    }
    scenarioToSlug.set(scenario.scenarioId, scenario.slug)
  }

  return { errors, warnings }
}
