import 'server-only'

import { type Browser, chromium } from 'playwright-core'
import { createRenderToken } from './render-token'

/**
 * Headless renderer for design documents.
 *
 * Opens the chrome-free render page in Chromium, waits for the editor stage to
 * report ready, and runs the editor's own export in the page, so a rendered
 * design is the same PNG the editor's Export button would produce.
 *
 * Enable with PLATFORM_DESIGN_RENDERER=enabled on hosts that have Chromium
 * (`npx playwright install chromium`, or PLATFORM_RENDER_CHROMIUM_PATH). The
 * renderer reaches the app at PLATFORM_RENDER_BASE_URL (default: the public
 * app URL); a separate render worker can point that at an internal address.
 */

const RENDER_TIMEOUT_MS = 60_000

export function isDesignRendererAvailable(): boolean {
  return process.env.PLATFORM_DESIGN_RENDERER === 'enabled'
}

function getRenderBaseUrl(): string {
  return (
    process.env.PLATFORM_RENDER_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  )
}

export type DesignRenderer = {
  close: () => Promise<void>
  render: (
    designId: string,
    organizationId: string
  ) => Promise<{ height: number; png: Buffer; width: number }>
}

/** One browser per agent run; each render gets a fresh page. */
export async function createDesignRenderer(): Promise<DesignRenderer> {
  const browser: Browser = await chromium.launch({
    executablePath: process.env.PLATFORM_RENDER_CHROMIUM_PATH || undefined,
    headless: true,
  })
  const baseUrl = new URL(getRenderBaseUrl())

  return {
    close: () => browser.close(),
    render: async (designId, organizationId) => {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        viewport: { height: 1400, width: 2200 },
      })
      try {
        const page = await context.newPage()
        // Only the app itself: no analytics or ad scripts in a render.
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url())
          return url.protocol === 'data:' ||
            url.protocol === 'blob:' ||
            url.origin === baseUrl.origin
            ? route.continue()
            : route.abort()
        })
        const url = new URL(`/render/${designId}`, baseUrl)
        url.searchParams.set('token', createRenderToken(designId, organizationId))
        const response = await page.goto(url.toString(), { timeout: RENDER_TIMEOUT_MS })
        if (!response?.ok())
          throw new Error(`Render page returned ${response?.status() ?? 'no response'}.`)
        await page.waitForFunction(() => window.__designReady === true, undefined, {
          timeout: RENDER_TIMEOUT_MS,
        })
        const result = await page.evaluate(() => window.__exportDesign!())
        return {
          height: result.height,
          png: Buffer.from(result.base64, 'base64'),
          width: result.width,
        }
      } finally {
        await context.close()
      }
    },
  }
}
