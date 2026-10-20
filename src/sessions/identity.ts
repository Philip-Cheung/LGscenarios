import type { SupabaseClient } from '@supabase/supabase-js'

export type IdentityResult = { ok: true; userId: string } | { ok: false; error: 'auth_failed' | 'captcha_required' | 'rate_limited' }

/** Returns the current Supabase Auth user, refreshing an expired token if possible. */
export async function getExistingUserId(client: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data.session?.user.id ?? null
  } catch {
    return null
  }
}

/**
 * Reuses a valid session; otherwise creates an anonymous identity. Anonymous
 * users carry the `authenticated` database role but have no name or email.
 */
export async function ensureIdentity(client: SupabaseClient, captchaToken?: string): Promise<IdentityResult> {
  const existing = await getExistingUserId(client)
  if (existing) return { ok: true, userId: existing }
  try {
    const { data, error } = await client.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined)
    if (error || !data.user) {
      if (error?.status === 429) return { ok: false, error: 'rate_limited' }
      if (error && /captcha/i.test(error.message)) return { ok: false, error: 'captcha_required' }
      return { ok: false, error: 'auth_failed' }
    }
    return { ok: true, userId: data.user.id }
  } catch {
    return { ok: false, error: 'auth_failed' }
  }
}
