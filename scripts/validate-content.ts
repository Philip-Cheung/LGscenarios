import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseScenarioFile, toStoredContent, validateScenarioFiles } from '../src/lib/content'
import { buildJsonSchema } from './jsonSchema'
import {
  fileNameProblem,
  JSON_SCHEMA_PATH,
  listMigrationFiles,
  MIGRATIONS_DIR,
  readScenarioFiles,
  scenarioMigrationName,
} from './scenarios'

const files = readScenarioFiles()
const report = validateScenarioFiles(files.map((file) => file.raw))

if (!existsSync(JSON_SCHEMA_PATH) || readFileSync(JSON_SCHEMA_PATH, 'utf8') !== buildJsonSchema()) {
  report.errors.push('content/scenario.schema.json is out of date (npm run scenario:schema)')
}

const migrations = listMigrationFiles().sort()
for (const file of files) {
  const problem = fileNameProblem(file.path, file.raw)
  if (problem) report.errors.push(problem)

  const parsed = parseScenarioFile(file.raw)
  if (!parsed.success) continue
  const scenario = parsed.data
  const name = scenarioMigrationName(scenario)
  const latest = migrations.filter((migration) => migration.endsWith(`_${name}.sql`)).at(-1)
  const command = `npm run scenario:publish -- content/scenarios/${scenario.id}.v${scenario.version}.json`
  if (!latest) {
    report.warnings.push(`${scenario.id} v${scenario.version} has no ${scenario.status} migration yet (${command})`)
    continue
  }
  const sql = readFileSync(join(MIGRATIONS_DIR, latest), 'utf8')
  if (!sql.includes(JSON.stringify(toStoredContent(scenario), null, 2))) {
    report.warnings.push(`${scenario.id} v${scenario.version} changed since ${latest} (${command})`)
  }
}

for (const warning of report.warnings) console.warn(`warning: ${warning}`)
if (report.errors.length > 0) {
  for (const error of report.errors) console.error(`error: ${error}`)
  console.error(`Content validation failed with ${report.errors.length} error(s).`)
  process.exit(1)
}
console.log(`Validated ${files.length} scenario file(s); ${report.warnings.length} warning(s).`)
