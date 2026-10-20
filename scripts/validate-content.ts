import { validateScenarioSet } from '../src/lib/content'
import { allScenarios, CURRENT_SCENARIO_SLUG, findLatestBundledBySlug } from '../src/scenarios'
import { hasRegistryMigration } from './registry'

const report = validateScenarioSet(allScenarios)

if (!findLatestBundledBySlug(CURRENT_SCENARIO_SLUG)) {
  report.errors.push(`CURRENT_SCENARIO_SLUG "${CURRENT_SCENARIO_SLUG}" does not match any bundled scenario`)
}

for (const scenario of allScenarios) {
  if (!hasRegistryMigration(scenario)) {
    report.warnings.push(
      `${scenario.scenarioId} v${scenario.version} has no registry migration yet ` +
        `(npm run registry:generate -- ${scenario.scenarioId} ${scenario.version})`,
    )
  }
}

for (const warning of report.warnings) console.warn(`warning: ${warning}`)
if (report.errors.length > 0) {
  for (const error of report.errors) console.error(`error: ${error}`)
  console.error(`Content validation failed with ${report.errors.length} error(s).`)
  process.exit(1)
}
console.log(`Validated ${allScenarios.length} scenario version(s); ${report.warnings.length} warning(s).`)
