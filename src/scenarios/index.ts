import type { ScenarioContent } from '../lib/content'
import { sampleDoorstepV1 } from './sample-doorstep.v1'

/**
 * Every scenario version the frontend can render. Keep old versions here while
 * sessions or links may still depend on them; never edit a published version.
 */
export const allScenarios: readonly ScenarioContent[] = [sampleDoorstepV1]

export function findScenarioVersion(scenarioId: string, version: number): ScenarioContent | undefined {
  return allScenarios.find((scenario) => scenario.scenarioId === scenarioId && scenario.version === version)
}

/** The highest version bundled for a slug, used for the landing title. */
export function findLatestBundledBySlug(slug: string): ScenarioContent | undefined {
  let latest: ScenarioContent | undefined
  for (const scenario of allScenarios) {
    if (scenario.slug === slug && (!latest || scenario.version > latest.version)) latest = scenario
  }
  return latest
}
