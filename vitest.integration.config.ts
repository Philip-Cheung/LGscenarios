import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Real-database tests. Reads TEST_* values from the git-ignored .env.test.local.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    env: loadEnv('test', process.cwd(), 'TEST_'),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
})
