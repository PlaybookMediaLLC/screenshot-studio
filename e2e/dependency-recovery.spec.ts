import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { signUpAndCreateWorkspace } from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'

const composeArguments = ['compose', '--env-file', '.local/dev.env', '--file', 'compose.yaml']
const assetUpload = {
  bytes: 1,
  classification: 'input',
  contentType: 'image/png',
  fileName: 'resilience.png',
  sha256: '0'.repeat(64),
}

function compose(...args: string[]): void {
  execFileSync('docker', [...composeArguments, ...args], { cwd: process.cwd(), stdio: 'inherit' })
}

function restartService(service: string): void {
  compose('up', '--detach', service)
}

async function waitForStatus(
  request: () => Promise<number>,
  expectedStatus: number
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await request()) === expectedStatus) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`The recovered dependency did not return ${expectedStatus}.`)
}

function stopService(service: string): void {
  compose('stop', service)
}

async function verifyServiceRecovery(
  service: string,
  request: () => Promise<number>,
  unavailableStatus: number,
  recoveredStatus: number
): Promise<void> {
  try {
    stopService(service)
    expect(await request()).toBe(unavailableStatus)
  } finally {
    restartService(service)
  }
  await waitForStatus(request, recoveredStatus)
}

configureE2EFlow()

test('required dependencies return a safe failure or recover without data loss', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const identifier = `e2e-recovery-${randomUUID()}`
  const screenshotRequest = () =>
    requestJson(
      page,
      '/api/screenshot',
      {
        colorScheme: 'light',
        deviceType: 'desktop',
        url: `https://recovery.example/${identifier}`,
      },
      'POST',
      { 'x-forwarded-for': identifier }
    )

  await verifyServiceRecovery('redis', async () => (await screenshotRequest()).status, 503, 200)
  await verifyServiceRecovery('minio', async () => (await screenshotRequest()).status, 200, 200)
  await verifyServiceRecovery(
    'storage',
    async () => (await requestJson(page, '/api/tenant/assets/upload-url', assetUpload)).status,
    503,
    201
  )
  await verifyServiceRecovery(
    'postgres',
    async () => (await browserRequest(page, '/api/tenant/releases')).status,
    503,
    200
  )
})
