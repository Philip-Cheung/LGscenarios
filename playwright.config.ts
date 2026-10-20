import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'
import { assertDisposableTarget } from './supabase/tests/target'

/**
 * End-to-end tests against the real disposable test Supabase project.
 * The app is built into dist-e2e with the TEST_* project values (never the
 * deploy build) and served by `vite preview`, which applies vercel.json headers.
 */
const testEnv = loadEnv('test', process.cwd(), 'TEST_')
for (const [key, value] of Object.entries(testEnv)) process.env[key] ??= value
// Checked before the web server builds anything.
assertDisposableTarget()

const PORT = 4174
export const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `${BASE_URL}/s/sample-doorstep`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.TEST_SUPABASE_URL ?? '',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.TEST_SUPABASE_PUBLISHABLE_KEY ?? '',
      VITE_TURNSTILE_SITE_KEY: process.env.TEST_TURNSTILE_SITE_KEY ?? '',
    },
  },
})
