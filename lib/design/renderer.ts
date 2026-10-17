import 'server-only'

import { type Browser, chromium } from 'playwright-core'
import { GOOGLE_FONT_ORIGINS } from '@/lib/typography/google-fonts'
import { createRenderToken } from './render-token'

/**
 * Headless renderer for design documents.
 *
 * Opens the chrome-free render page in Chromium, waits for the editor stage to
 * report ready, and runs the editor's own export in the page, so a rendered
 * design is the same PNG the editor's Export button would produce.
 *
 * Enable with PLATFORM_DESIGN_RENDERER=enabled. With PLATFORM_RENDER_CDP_URL
 * the browser is remote, reached over the Chrome DevTools Protocol: Cloudflare
 * Browser Rendering in production (authorized by PLATFORM_RENDER_CDP_TOKEN),
 * or the Compose headless Chrome locally. Without it, Chromium runs in this
 * process (`npx playwright install chromium` or PLATFORM_RENDER_CHROMIUM_PATH).
 * Either way the browser opens the app at PLATFORM_RENDER_BASE_URL (default:
 * the public app URL), so a remote browser must be able to reach it.
 */

const RENDER_TIMEOUT_MS = 60_000

export function isDesignRendererAvailable(): boolean {
  return process.env.PLATFORM_DESIGN_RENDERER === 'enabled'
}

let readiness: { expiresAt: number; ready: boolean } | null = null

/**
 * Whether renders can run right now (cached briefly). A local CDP browser
 * answers /json/version; Cloudflare opens a billed session on connect, so it
 * is trusted until a render fails. Callers fall back to sharp product shots
 * when this is false.
 */
export async function isDesignRendererReady(): Promise<boolean> {
  if (!isDesignRendererAvailable()) return false
  const cdpUrl = process.env.PLATFORM_RENDER_CDP_URL
  if (!cdpUrl?.startsWith('http')) return true
  if (readiness && readiness.expiresAt > Date.now()) return readiness.ready
  const ready = await fetch(new URL('/json/version', cdpUrl), {
    signal: AbortSignal.timeout(8_000),
  })
    .then((response) => response.ok)
    .catch(() => false)
  readiness = { expiresAt: Date.now() + (ready ? 30_000 : 10_000), ready }
  return ready
}

function getRenderBaseUrl(): string {
  return (
    process.env.PLATFORM_RENDER_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  )
}

export type DesignRenderOptions = {
  /** Default `png`. JPEG suits previews and photo-heavy designs. */
  format?: 'jpeg' | 'png' | 'webp'
  /** Multiple of the aspect ratio's base size. Default 2, the editor's export default. */
  scale?: 1 | 2 | 3
}

export type RenderedDesign = {
  bytes: Buffer
  height: number
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
}

export type DesignRenderer = {
  close: () => Promise<void>
  render: (
    designId: string,
    organizationId: string,
    options?: DesignRenderOptions
  ) => Promise<RenderedDesign>
}

type ExportResult = { base64: string; height: number; mediaType?: string; width: number }

function toRenderedDesign(result: ExportResult, options: DesignRenderOptions): RenderedDesign {
  return {
    bytes: Buffer.from(result.base64, 'base64'),
    height: result.height,
    mediaType: `image/${options.format ?? 'png'}` as RenderedDesign['mediaType'],
    width: result.width,
  }
}

function renderPageUrl(
  designId: string,
  organizationId: string,
  options: DesignRenderOptions
): URL {
  const url = new URL(`/render/${designId}`, getRenderBaseUrl())
  url.searchParams.set('token', createRenderToken(designId, organizationId))
  url.searchParams.set('format', options.format ?? 'png')
  url.searchParams.set('scale', String(options.scale ?? 2))
  return url
}

function openBrowser(): Promise<Browser> {
  const cdpUrl = process.env.PLATFORM_RENDER_CDP_URL
  if (cdpUrl) {
    const token = process.env.PLATFORM_RENDER_CDP_TOKEN
    return chromium.connectOverCDP(cdpUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeout: RENDER_TIMEOUT_MS,
    })
  }
  return chromium.launch({
    executablePath: process.env.PLATFORM_RENDER_CHROMIUM_PATH || undefined,
    headless: true,
  })
}

/** One browser per agent run, with a fresh context per render. */
export async function createDesignRenderer(): Promise<DesignRenderer> {
  let browser = await openBrowser()
  const baseUrl = new URL(getRenderBaseUrl())

  return {
    close: () => browser.close(),
    render: async (designId, organizationId, options = {}) => {
      // A remote session ends after its idle keep_alive; reconnect if it did.
      if (!browser.isConnected()) browser = await openBrowser()
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        viewport: { height: 1400, width: 2200 },
      })
      try {
        const page = await context.newPage()
        // Only the app itself and Google Fonts (text may use them): no
        // analytics or ad scripts in a render.
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url())
          return url.protocol === 'data:' ||
            url.protocol === 'blob:' ||
            url.origin === baseUrl.origin ||
            (GOOGLE_FONT_ORIGINS as readonly string[]).includes(url.origin)
            ? route.continue()
            : route.abort()
        })
        const response = await page.goto(
          renderPageUrl(designId, organizationId, options).toString(),
          {
            timeout: RENDER_TIMEOUT_MS,
          }
        )
        if (!response?.ok())
          throw new Error(`Render page returned ${response?.status() ?? 'no response'}.`)
        await page.waitForFunction(() => window.__designReady === true, undefined, {
          timeout: RENDER_TIMEOUT_MS,
        })
        return toRenderedDesign(await page.evaluate(() => window.__exportDesign!()), options)
      } finally {
        await context.close()
      }
    },
  }
}
