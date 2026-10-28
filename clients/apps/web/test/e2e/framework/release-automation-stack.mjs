import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'

const mode = process.argv[2]
const configPath = '.context/release-automation-fixture.json'
const root = process.cwd()

function localURL(value, name, schemes = ['http:', 'https:']) {
  const url = new URL(value)
  if (
    !schemes.includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(`${name} must point to an isolated local fixture.`)
  }
  return url
}

if (mode === 'prepare') {
  const database = localURL(process.env.E2E_DATABASE_URL, 'E2E_DATABASE_URL', [
    'postgres:',
    'postgresql:',
  ])
  if (!database.pathname.includes('test')) throw new Error('Use a dedicated test database.')
  localURL(process.env.E2E_REDIS_URL, 'E2E_REDIS_URL', ['redis:'])
  localURL(process.env.E2E_R2_ENDPOINT, 'E2E_R2_ENDPOINT')
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3049'
  localURL(baseURL, 'E2E_BASE_URL')
  const temporal = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7253'
  localURL(`http://${temporal}`, 'TEMPORAL_ADDRESS')
  const githubPort = process.env.E2E_GITHUB_PORT ?? '8039'
  const apiPort = process.env.E2E_API_PORT ?? '8099'
  const socialPort = process.env.E2E_SOCIAL_PORT ?? '8049'
  if (
    ![githubPort, apiPort, socialPort].every(
      (value) => /^\d{4,5}$/.test(value) && Number(value) < 65536
    )
  )
    throw new Error('Invalid fixture port.')
  const githubURL = `http://localhost:${githubPort}`
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const secret = () => randomBytes(32).toString('hex')
  const webhookSecret = secret()
  const env = {
    DATABASE_URL: database.toString(),
    HOST_DATABASE_URL: database.toString(),
    E2E_DATABASE_URL: database.toString(),
    AUDIT_RETENTION_DATABASE_URL: database.toString(),
    REDIS_URL: process.env.E2E_REDIS_URL,
    E2E_REDIS_URL: process.env.E2E_REDIS_URL,
    R2_ENDPOINT: process.env.E2E_R2_ENDPOINT,
    R2_BROWSER_ENDPOINT: process.env.E2E_R2_ENDPOINT,
    R2_ACCESS_KEY_ID: process.env.E2E_R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.E2E_R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.E2E_R2_BUCKET_NAME,
    R2_REGION: process.env.E2E_R2_REGION ?? 'us-east-1',
    R2_FORCE_PATH_STYLE: 'true',
    E2E_R2_ENDPOINT: process.env.E2E_R2_ENDPOINT,
    E2E_R2_ACCESS_KEY_ID: process.env.E2E_R2_ACCESS_KEY_ID,
    E2E_R2_SECRET_ACCESS_KEY: process.env.E2E_R2_SECRET_ACCESS_KEY,
    E2E_R2_BUCKET_NAME: process.env.E2E_R2_BUCKET_NAME,
    E2E_R2_REGION: process.env.E2E_R2_REGION ?? 'us-east-1',
    BETTER_AUTH_SECRET: secret(),
    SOURCE_WEBHOOK_SIGNING_KEY: secret(),
    PUBLISHING_SERVICE_TOKEN: secret(),
    BETTER_AUTH_URL: baseURL,
    BETTER_AUTH_TRUSTED_ORIGINS: baseURL,
    NEXT_PUBLIC_APP_URL: baseURL,
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
    AUTH_EMAIL_WEBHOOK_URL: `${githubURL}/mail`,
    PUBLISHING_API_URL: `http://127.0.0.1:${apiPort}`,
    PORT: apiPort,
    GITHUB_APP_ID: '123',
    GITHUB_APP_CLIENT_ID: 'fixture-client',
    GITHUB_APP_CLIENT_SECRET: secret(),
    GITHUB_APP_SLUG: 'release-fixture',
    GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
    GITHUB_APP_PRIVATE_KEY: Buffer.from(
      privateKey.export({ type: 'pkcs1', format: 'pem' })
    ).toString('base64'),
    GITHUB_API_URL: githubURL,
    GITHUB_WEB_URL: githubURL,
    E2E_GITHUB_WEBHOOK_SECRET: webhookSecret,
    E2E_GITHUB_PORT: githubPort,
    TEMPORAL_ADDRESS: temporal,
    E2E_BASE_URL: baseURL,
    E2E_RELEASE_AUTOMATION: '1',
    RELEASE_AUTOMATION_E2E_WORKER: '1',
    PLATFORM_CAMPAIGN_WORKFLOW: 'true',
    PLATFORM_CONTENT_DRAFTS: 'true',
    // Each Playwright worker binds to its own secret (framework/social-mock.ts).
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, slot) => [`SOCIAL_API_KEY_E2E_W${slot}`, 'local-fixture-only'])
    ),
    SOCIAL_API_URL: `http://127.0.0.1:${socialPort}/api/public/v1`,
    E2E_SOCIAL_PORT: socialPort,
    RESEND_API_KEY: '',
    OPENAI_API_KEY: '',
    // Paid workflow copy calls the local fake model in the GitHub fixture.
    OPENROUTER_API_KEY: 'fixture-only-local-model',
    OPENROUTER_BASE_URL: `${githubURL}/api/v1`,
    // Workflow renders: the worker signs requests to the web, which renders
    // designs with a local headless Chromium.
    PLATFORM_WORKFLOW_RENDER_URL: baseURL,
    PLATFORM_WORKFLOW_RENDER_KEY: secret(),
    PLATFORM_DESIGN_RENDERER: 'enabled',
    PLATFORM_RENDER_BASE_URL: baseURL,
  }
  for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
    if (!env[name]) throw new Error(`${name} fixture configuration is required.`)
  }
  mkdirSync('.context', { recursive: true })
  writeFileSync(configPath, JSON.stringify(env), { mode: 0o600 })
  process.stdout.write(`Local fixture configuration written to ${configPath}. Keep it private.\n`)
} else {
  const env = { ...process.env, ...JSON.parse(readFileSync(configPath, 'utf8')) }
  let command = process.execPath,
    args,
    cwd = root
  switch (mode) {
    case 'migrate':
      command = 'go'
      args = ['run', './cmd/platform-migrate']
      cwd = resolve(root, '../../../server')
      break
    case 'api':
      command = 'go'
      args = ['run', './cmd/product-api']
      cwd = resolve(root, '../../../server')
      break
    case 'worker':
      command = 'go'
      args = [
        'test',
        './internal/temporalreleaseautomation',
        '-run',
        '^TestBrowserFixtureWorker$',
        '-count=1',
        '-timeout=60m',
        '-v',
      ]
      cwd = resolve(root, '../../../server')
      break
    case 'github':
      args = ['scripts/e2e-release-automation-mock.mjs']
      break
    case 'web':
      args = [
        '../../node_modules/next/dist/bin/next',
        'dev',
        '--port',
        new URL(env.E2E_BASE_URL).port || '3000',
      ]
      env.DATABASE_URL = ''
      env.HOST_DATABASE_URL = ''
      env.AUDIT_RETENTION_DATABASE_URL = ''
      env.OPENROUTER_API_KEY = ''
      env.OPENROUTER_BASE_URL = ''
      break
    case 'test':
      args = [
        '../../node_modules/@playwright/test/cli.js',
        'test',
        'test/e2e/release-automation.spec.ts',
        '--workers=1',
      ]
      break
    default:
      throw new Error('Choose prepare, migrate, api, worker, github, web, or test.')
  }
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: true })
  const stop = (signal) => {
    try {
      process.kill(-child.pid, signal)
    } catch {
      /* Process already exited. */
    }
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
