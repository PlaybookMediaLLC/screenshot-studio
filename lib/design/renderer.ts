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
 * Enable with PLATFORM_DESIGN_RENDERER=enabled. In production, point
 * PLATFORM_RENDER_SERVICE_URL (+ PLATFORM_RENDER_SERVICE_SECRET) at the
 * design render service (services/design-renderer), which keeps Chromium out
 * of the web image. Without it, Chromium runs in this process (local
 * development; `npx playwright install chromium` or
 * PLATFORM_RENDER_CHROMIUM_PATH). Either way the browser opens the app at
 * PLATFORM_RENDER_BASE_URL (default: the public app URL).
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

function renderPageUrl(designId: string, organizationId: string): URL {
  const url = new URL(`/render/${designId}`, getRenderBaseUrl())
  url.searchParams.set('token', createRenderToken(designId, organizationId))
  return url
}

/** Renders through the design render service over HTTP. */
function createServiceRenderer(serviceUrl: string): DesignRenderer {
  return {
    close: async () => {},
    render: async (designId, organizationId) => {
      const response = await fetch(new URL('/render', serviceUrl), {
        body: JSON.stringify({ url: renderPageUrl(designId, organizationId).toString() }),
        headers: {
          'content-type': 'application/json',
          'x-render-secret': process.env.PLATFORM_RENDER_SERVICE_SECRET ?? '',
        },
        method: 'POST',
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS + 15_000),
      })
      if (!response.ok) throw new Error(`Render service returned ${response.status}.`)
      const result = (await response.json()) as { base64: string; height: number; width: number }
      return {
        height: result.height,
        png: Buffer.from(result.base64, 'base64'),
        width: result.width,
      }
    },
  }
}

/** One renderer per agent run; locally, one browser with a fresh page per render. */
export async function createDesignRenderer(): Promise<DesignRenderer> {
  const serviceUrl = process.env.PLATFORM_RENDER_SERVICE_URL
  if (serviceUrl) return createServiceRenderer(serviceUrl)

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
        const response = await page.goto(renderPageUrl(designId, organizationId).toString(), {
          timeout: RENDER_TIMEOUT_MS,
        })
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
