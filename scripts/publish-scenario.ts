/**
 * Writes the migration that stores one reviewed scenario file.
 *
 *   npm run scenario:publish -- content/scenarios/who-is-god.v1.json
 *
 * The file's `status` decides the outcome: "draft" stores it hidden from
 * participants, "published" freezes it and opens it for new pairs. Apply the
 * migration with `npm run db:push`; no frontend deploy is needed.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { scenarioFileSchema, validateScenarioFiles } from '../src/lib/content'
import {
  buildScenarioMigrationSql,
  fileNameProblem,
  MIGRATIONS_DIR,
  nextMigrationTimestamp,
  readScenarioFiles,
  scenarioMigrationName,
} from './scenarios'

const [target] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
if (!target) {
  console.error('Usage: npm run scenario:publish -- content/scenarios/<id>.v<N>.json')
  process.exit(1)
}

const files = readScenarioFiles()
const report = validateScenarioFiles(files.map((file) => file.raw))
for (const file of files) {
  const problem = fileNameProblem(file.path, file.raw)
  if (problem) report.errors.push(problem)
}
if (report.errors.length > 0) {
  console.error('Content validation failed:\n' + report.errors.map((error) => `  - ${error}`).join('\n'))
  process.exit(1)
}

const targetPath = resolve(target)
const entry = files.find((file) => resolve(file.path) === targetPath)
if (!entry) {
  console.error(`${target} is not a file in content/scenarios.`)
  process.exit(1)
}

const scenario = scenarioFileSchema.parse(entry.raw)
const repoRoot = resolve(MIGRATIONS_DIR, '..', '..')
const fileName = `${nextMigrationTimestamp()}_${scenarioMigrationName(scenario)}.sql`
const filePath = join(MIGRATIONS_DIR, fileName)
if (existsSync(filePath)) {
  console.error(`${fileName} already exists`)
  process.exit(1)
}
writeFileSync(filePath, buildScenarioMigrationSql(scenario, relative(repoRoot, entry.path)))
for (const warning of report.warnings) console.warn(`warning: ${warning}`)
console.log(`Wrote supabase/migrations/${fileName} (${scenario.status}). Apply it with npm run db:push.`)
