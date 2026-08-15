import { execFileSync } from 'node:child_process'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'

const secretNames = [
  'AUDIT_DRAIN_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
  'CLEANUP_SECRET',
  'DATABASE_URL',
  'E2E_DATABASE_URL',
  'MINIO_ROOT_PASSWORD',
  'POSTGRES_APP_PASSWORD',
  'R2_SECRET_ACCESS_KEY',
  'REDIS_URL',
  'STORAGE_SERVICE_KEY',
] as const

function getSecrets(): string[] {
  return secretNames
    .map((name) => process.env[name])
    .filter((value): value is string => Boolean(value))
}

function assertNoSecrets(text: string, secrets: string[]): void {
  for (const secret of secrets) {
    expect(text.includes(secret)).toBe(false)
  }
}

function getComposeLogs(): string {
  return execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.local/dev.env',
      '--file',
      'compose.yaml',
      'logs',
      '--no-color',
      '--tail',
      '300',
      'app',
      'storage',
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
}

configureE2EFlow()

test('server secrets never appear in browser data or local dependency logs', async ({
  app,
  page,
}) => {
  await app.open('/sign-in')
  const [health, session, screenshot] = await Promise.all([
    browserRequest(page, '/api/health'),
    browserRequest(page, '/api/auth/get-session'),
    requestJson(page, '/api/screenshot', { url: 'not-a-url' }),
  ])
  const bundles = await page.locator('script[src]').evaluateAll(async (scripts) => {
    return Promise.all(
      [...scripts].map(async (script) => {
        const source = script.getAttribute('src')
        return source ? (await fetch(source)).text() : ''
      })
    )
  })
  const secrets = getSecrets()

  assertNoSecrets(
    [
      await page.content(),
      ...bundles,
      JSON.stringify(health.body),
      JSON.stringify(session.body),
      JSON.stringify(screenshot.body),
    ].join('\n'),
    secrets
  )
  if (process.env.E2E_COMPOSE_LOGS === 'true') {
    assertNoSecrets(getComposeLogs(), secrets)
  }
})
