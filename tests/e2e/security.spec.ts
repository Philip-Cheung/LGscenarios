import { expect, test } from '@playwright/test'
import { SCENARIO_PATH } from './helpers'

test('serves the security headers and a strict content security policy', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text())
  })

  const response = await page.goto(SCENARIO_PATH)
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('no-referrer')

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  const supabaseOrigin = new URL(process.env.TEST_SUPABASE_URL ?? '').origin
  expect(policy).toContain(`connect-src 'self' ${supabaseOrigin}`)
  expect(policy).not.toContain('*')
  expect(policy).not.toContain('unsafe-inline')
  expect(policy).not.toContain('unsafe-eval')

  await expect(page.getByRole('button', { name: 'Create a practice' })).toBeVisible()
  expect(violations).toEqual([])
})

test('unknown and draft scenario links get the same friendly explanation', async ({ page }) => {
  await page.goto('/s/not-a-real-scenario')
  await expect(page.getByRole('heading', { level: 1, name: 'This scenario is not available' })).toBeVisible()
  // Drafts are hidden by row-level security until they are published, and look like any unknown link.
  await page.goto('/s/who-is-god')
  await expect(page.getByRole('heading', { level: 1, name: 'This scenario is not available' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create a practice' })).toHaveCount(0)
  await page.goto('/s/Not_A_Link')
  await expect(page.getByRole('heading', { name: 'We could not find that scenario' })).toBeVisible()
})

test('the site root opens the most recently published scenario', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/s\/[a-z0-9-]+$/)
  await expect(page.getByRole('button', { name: 'Create a practice' })).toBeVisible()
})

test('the development preview gallery is not shipped', async ({ page }) => {
  await page.goto('/dev/preview')
  await expect(page.getByRole('heading', { name: 'We could not find that scenario' })).toBeVisible()
})

test('no secrets are present in the shipped JavaScript', async ({ page }) => {
  const bodies: string[] = []
  page.on('response', async (response) => {
    if (response.url().endsWith('.js')) bodies.push(await response.text())
  })
  await page.goto(SCENARIO_PATH)
  await page.waitForLoadState('networkidle')
  const bundle = bodies.join('\n')
  expect(bundle.length).toBeGreaterThan(0)
  // Actual key material, not the guard strings the config check compares against.
  expect(bundle).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/)
  expect(bundle).not.toMatch(/postgres(ql)?:\/\/[^\s'"`]+@/)
  for (const token of bundle.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { role?: string }
    expect(payload.role).not.toBe('service_role')
  }
})
