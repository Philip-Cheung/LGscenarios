/**
 * Generates a registry migration for one validated scenario version.
 *
 *   npm run registry:generate -- <scenario-id> <version> [--publish]
 *
 * Without --publish the entry is inserted inactive (deploy frontend support
 * first). --publish also makes it available for new sessions.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateScenarioSet } from '../src/lib/content'
import { allScenarios, findScenarioVersion } from '../src/scenarios'
import { MIGRATIONS_DIR, buildRegistryMigrationSql, migrationTimestamp, registryMigrationName } from './registry'

const args = process.argv.slice(2)
const publish = args.includes('--publish')
const [scenarioId, versionArg] = args.filter((arg) => !arg.startsWith('--'))

if (!scenarioId || !versionArg || !/^\d+$/.test(versionArg)) {
  console.error('Usage: npm run registry:generate -- <scenario-id> <version> [--publish]')
  process.exit(1)
}

const report = validateScenarioSet(allScenarios)
if (report.errors.length > 0) {
  console.error('Content validation failed:\n' + report.errors.map((error) => `  - ${error}`).join('\n'))
  process.exit(1)
}

const scenario = findScenarioVersion(scenarioId, Number(versionArg))
if (!scenario) {
  console.error(`No bundled content for ${scenarioId} v${versionArg}. Add it to src/scenarios/index.ts first.`)
  process.exit(1)
}

const fileName = `${migrationTimestamp()}_${registryMigrationName(scenario, publish)}.sql`
const filePath = join(MIGRATIONS_DIR, fileName)
if (existsSync(filePath)) {
  console.error(`${fileName} already exists`)
  process.exit(1)
}
writeFileSync(filePath, buildRegistryMigrationSql(scenario, publish))
console.log(`Wrote supabase/migrations/${fileName}`)
