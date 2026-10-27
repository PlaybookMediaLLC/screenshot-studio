import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const recoveryTest = 'test/e2e/dependency-recovery.spec.ts'
const testIgnore = process.env.E2E_INCLUDE_RECOVERY === 'true' ? undefined : [recoveryTest]
// Every context starts with a saved cookie choice so the consent banner
// never covers the controls a flow clicks.
const storageState = {
  cookies: [],
  origins: [
    {
      origin: new URL(baseURL).origin,
      // Post options start open so composer flows reach thread and automation controls.
      localStorage: [
        { name: 'shots-consent', value: '{"analytics":false,"ads":false}' },
        { name: 'shots-post-options', value: 'open' },
      ],
    },
  ],
}

export default defineConfig({
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  retries: process.env.CI ? 2 : 0,
  testDir: './test/e2e',
  testIgnore,
  // A cold Next.js dev route compiles on first request, so the first flow to
  // reach the editor can spend most of a minute before hydration finishes.
  // The per-test budget has to leave room for that plus the flow itself.
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    storageState,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
