import { randomUUID } from 'node:crypto'
import { test as base, type Page } from '@playwright/test'

export type E2EIdentity = {
  email: string
  name: string
  password: string
  workspaceName: string
}

/** Waits until React has hydrated the page (components/platform-shell/HydrationMarker.tsx). */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true')
}

/** A unique local user for one test. */
export function createIdentity(): E2EIdentity {
  const suffix = randomUUID().slice(0, 8)
  return {
    email: `e2e-${suffix}@example.test`,
    name: 'E2E Test User',
    password: 'e2e-only-test-password',
    workspaceName: `E2E Workspace ${suffix}`,
  }
}

/** Setup helpers nest; only the outermost one records its time. */
let setupDepth = 0

/**
 * Runs a setup helper as a "setup:" step and records its time as a
 * `setup-ms` annotation. The JSON report drops steps that run inside
 * fixtures, but keeps annotations (scripts/e2e-durations.mjs).
 */
export function setupStep<Args extends unknown[], Result>(
  title: string,
  run: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const started = Date.now()
    setupDepth++
    try {
      return await base.step(`setup: ${title}`, () => run(...args))
    } finally {
      setupDepth--
      if (setupDepth === 0)
        base
          .info()
          .annotations.push({ type: 'setup-ms', description: String(Date.now() - started) })
    }
  }
}
