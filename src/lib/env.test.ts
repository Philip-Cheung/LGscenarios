import { readConfig } from './env'

const URL_OK = 'https://abcdefghijklmnop.supabase.co'

function jwt(payload: object) {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('readConfig', () => {
  it('accepts a publishable key and https URL', () => {
    const result = readConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
    expect(result).toEqual({
      ok: true,
      config: { supabaseUrl: URL_OK, supabasePublishableKey: 'sb_publishable_abc', turnstileSiteKey: null },
    })
  })

  it('reports missing values', () => {
    const result = readConfig({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems).toHaveLength(2)
  })

  it('refuses secret and service_role keys', () => {
    const secret = readConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })
    const serviceRole = readConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) })
    const anon = readConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }) })
    expect(secret.ok).toBe(false)
    expect(serviceRole.ok).toBe(false)
    expect(anon.ok).toBe(true)
  })

  it('refuses values that are not a publishable key', () => {
    for (const value of ['the sb_publishable_… value from your .env.test.local', 'not-a-key', jwt({ role: 'authenticated' })]) {
      const result = readConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: value })
      expect(result).toEqual({
        ok: false,
        problems: ['VITE_SUPABASE_PUBLISHABLE_KEY is not a publishable key (it should start with sb_publishable_)'],
      })
    }
  })

  it('requires https except for a local development server', () => {
    const key = 'sb_publishable_abc'
    expect(readConfig({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: key }).ok).toBe(false)
    expect(readConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: key }).ok).toBe(true)
  })
})
