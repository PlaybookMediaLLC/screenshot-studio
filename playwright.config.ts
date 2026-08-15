import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const recoveryTest = 'e2e/dependency-recovery.spec.ts'
const testIgnore = process.env.E2E_INCLUDE_RECOVERY === 'true' ? undefined : [recoveryTest]

export default defineConfig({
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  testIgnore,
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
