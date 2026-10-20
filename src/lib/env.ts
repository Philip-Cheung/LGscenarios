export interface AppConfig {
  supabaseUrl: string
  supabasePublishableKey: string
  turnstileSiteKey: string | null
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] }

interface RawEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  VITE_TURNSTILE_SITE_KEY?: string
}

/** Validates public build-time configuration. Never accepts secret keys. */
export function readConfig(env: RawEnv): ConfigResult {
  const problems: string[] = []
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  const turnstile = env.VITE_TURNSTILE_SITE_KEY?.trim() ?? ''

  if (!url) {
    problems.push('VITE_SUPABASE_URL is missing')
  } else {
    try {
      const parsed = new URL(url)
      const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)
      if (parsed.protocol !== 'https:' && !localHttp) problems.push('VITE_SUPABASE_URL must use https')
    } catch {
      problems.push('VITE_SUPABASE_URL is not a valid URL')
    }
  }

  if (!key) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing')
  } else if (key.startsWith('sb_secret_')) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key, not a secret key')
  } else if (jwtRole(key) === 'service_role') {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY must not be a service_role key')
  } else if (!PUBLISHABLE_KEY.test(key) && jwtRole(key) !== 'anon') {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is not a publishable key (it should start with sb_publishable_)')
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, config: { supabaseUrl: url, supabasePublishableKey: key, turnstileSiteKey: turnstile || null } }
}

const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/

/** The `role` claim of a legacy JWT API key, or null if the value is not one. */
function jwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

export const configResult: ConfigResult = readConfig(import.meta.env as RawEnv)
