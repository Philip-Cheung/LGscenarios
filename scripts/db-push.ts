/**
 * Applies committed migrations to a database with the Supabase CLI.
 *
 *   npm run db:push                 # uses TEST_DATABASE_URL from .env.test.local
 *   npm run db:push -- --env .env.production.local --var SUPABASE_DB_URL
 *
 * The connection string is read from a git-ignored env file and passed to the
 * CLI as --db-url; this script never prints it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const envFile = option('--env', '.env.test.local')
const variable = option('--var', 'TEST_DATABASE_URL')
const dryRun = args.includes('--dry-run')

if (!existsSync(envFile)) {
  console.error(`${envFile} not found. Copy .env.example and fill in the test project values.`)
  process.exit(1)
}
process.loadEnvFile(envFile)
const dbUrl = process.env[variable]
if (!dbUrl) {
  console.error(`${variable} is not set in ${envFile}.`)
  process.exit(1)
}

const cliArgs = ['supabase', 'db', 'push', '--db-url', dbUrl, '--include-all', ...(dryRun ? ['--dry-run'] : [])]
const result = spawnSync('npx', cliArgs, { stdio: 'inherit' })
process.exit(result.status ?? 1)
