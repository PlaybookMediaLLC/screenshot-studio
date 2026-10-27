import { randomUUID } from 'node:crypto'
import { expect, test as base, type Page, type TestInfo } from '@playwright/test'
import { clearRateLimits } from './services'

export { expect }

export type E2EIdentity = {
  email: string
  name: string
  password: string
  workspaceName: string
}

export type E2EApp = {
  expectPath: (path: string) => Promise<void>
  open: (path: string) => Promise<void>
}

export type E2EFlowContext = {
  app: E2EApp
  identity: E2EIdentity
  page: Page
  testInfo: TestInfo
}

export type E2EFlowHooks = {
  afterEach?: (context: E2EFlowContext) => Promise<void>
  beforeEach?: (context: E2EFlowContext) => Promise<void>
  onFailure?: (context: E2EFlowContext, error: unknown) => Promise<void>
}

type E2EFixtures = {
  app: E2EApp
  identity: E2EIdentity
}

function createIdentity(): E2EIdentity {
  const suffix = randomUUID().slice(0, 8)
  return {
    email: `e2e-${suffix}@example.test`,
    name: 'E2E Test User',
    password: 'e2e-only-test-password',
    workspaceName: `E2E Workspace ${suffix}`,
  }
}

function createApp(page: Page): E2EApp {
  return {
    expectPath: async (path: string): Promise<void> => {
      await expect.poll(() => new URL(page.url()).pathname).toBe(path)
    },
    open: async (path: string): Promise<void> => {
      await page.goto(path)
    },
  }
}

function createContext(
  app: E2EApp,
  identity: E2EIdentity,
  page: Page,
  testInfo: TestInfo
): E2EFlowContext {
  return { app, identity, page, testInfo }
}

async function attachFailureContext(context: E2EFlowContext): Promise<void> {
  await context.testInfo.attach('e2e-identity', {
    body: JSON.stringify({
      email: context.identity.email,
      workspaceName: context.identity.workspaceName,
    }),
    contentType: 'application/json',
  })
}

export const test = base.extend<E2EFixtures>({
  app: async ({ page }, assignFixture) => {
    await assignFixture(createApp(page))
  },
  identity: async ({ page: _page }, assignFixture) => {
    await assignFixture(createIdentity())
  },
})

export function configureE2EFlow(hooks: E2EFlowHooks = {}): void {
  test.beforeEach(async ({ app, identity, page }, testInfo) => {
    // Rate limits are keyed by client IP, so the whole shard shares one
    // budget and a spec can be rejected for requests made by earlier specs.
    // Reset before each test so a limit only reflects the test's own work.
    await clearRateLimits()
    await hooks.beforeEach?.(createContext(app, identity, page, testInfo))
  })
  test.afterEach(async ({ app, identity, page }, testInfo) => {
    const context = createContext(app, identity, page, testInfo)
    if (testInfo.status !== testInfo.expectedStatus) {
      const error = testInfo.errors[testInfo.errors.length - 1]
      try {
        await attachFailureContext(context)
        await hooks.onFailure?.(context, error)
      } finally {
        await hooks.afterEach?.(context)
      }
      return
    }
    await hooks.afterEach?.(context)
  })
}
