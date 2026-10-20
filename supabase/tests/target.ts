/**
 * Safety check shared by the database and E2E suites. Refuses to run
 * destructive tests unless the target is explicitly marked as disposable, the
 * API and database point at the same project, and neither matches a
 * production URL configured in this checkout. Never prints secret values.
 */
import { loadEnv } from 'vite'

export interface TestTarget {
  apiUrl: string
  publishableKey: string
  databaseUrl: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not set. Fill in .env.test.local for the disposable test project (see README).`)
  }
  return value
}

function projectRefFromApiUrl(url: string): string | null {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url)
  return match ? match[1] : null
}

function projectRefFromDbUrl(url: string): string | null {
  const parsed = new URL(url)
  const userMatch = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username))
  if (userMatch) return userMatch[1]
  const hostMatch = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)
  return hostMatch ? hostMatch[1] : null
}

export function assertDisposableTarget(): TestTarget {
  const apiUrl = required('TEST_SUPABASE_URL')
  const publishableKey = required('TEST_SUPABASE_PUBLISHABLE_KEY')
  const databaseUrl = required('TEST_DATABASE_URL')

  if (process.env.TEST_PROJECT_IS_DISPOSABLE !== 'yes') {
    throw new Error('Set TEST_PROJECT_IS_DISPOSABLE=yes in .env.test.local to confirm the target is a throwaway test project.')
  }
  if (publishableKey.startsWith('sb_secret_')) {
    throw new Error('TEST_SUPABASE_PUBLISHABLE_KEY must be the publishable key, not a secret key.')
  }

  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(apiUrl)
  if (!local) {
    const apiRef = projectRefFromApiUrl(apiUrl)
    const dbRef = projectRefFromDbUrl(databaseUrl)
    if (!apiRef || !dbRef || apiRef !== dbRef) {
      throw new Error('TEST_SUPABASE_URL and TEST_DATABASE_URL must point at the same Supabase project.')
    }
  }

  const production = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  if (production && new URL(production).origin === new URL(apiUrl).origin) {
    throw new Error('TEST_SUPABASE_URL matches the production VITE_SUPABASE_URL. Refusing to run destructive tests.')
  }
  return { apiUrl, publishableKey, databaseUrl }
}
