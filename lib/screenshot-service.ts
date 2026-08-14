import 'server-only'
import { z } from 'zod'
import type { ScreenshotRequest } from '@/lib/api/schemas'

const MICROLINK_API_URL = process.env.SCREENSHOT_API_URL || 'https://api.microlink.io'

const microlinkResponseSchema = z.object({
  data: z
    .object({
      message: z.string().optional(),
      screenshot: z.object({ url: z.string().url() }).optional(),
      url: z.string().optional(),
    })
    .optional(),
  status: z.string(),
})

type Viewport = {
  height: string
  isMobile: string
  width: string
}

export type ScreenshotCapture = {
  screenshot: string
  strategy: 'microlink'
}

export type ScreenshotFailure = {
  message: string
  status: number
}

function getViewport(deviceType: ScreenshotRequest['deviceType']): Viewport {
  if (deviceType === 'mobile') {
    return { height: '667', isMobile: 'true', width: '375' }
  }

  return { height: '1080', isMobile: 'false', width: '1920' }
}

function getCaptureUrl(input: ScreenshotRequest): string {
  const viewport = getViewport(input.deviceType)
  const params = new URLSearchParams({
    'viewport.height': viewport.height,
    'viewport.isMobile': viewport.isMobile,
    'viewport.width': viewport.width,
    colorScheme: input.colorScheme,
    meta: 'false',
    screenshot: 'true',
    url: input.url,
  })

  return `${MICROLINK_API_URL}/?${params.toString()}`
}

function getServiceError(response: Response, data: z.infer<typeof microlinkResponseSchema>): Error {
  if (response.status === 408 || response.status === 504) {
    return new Error('timeout')
  }
  if (response.status === 429) {
    return new Error('connection_error')
  }

  return new Error(
    data.data?.url || data.data?.message || `Screenshot API returned ${response.status}`
  )
}

async function requestScreenshotUrl(input: ScreenshotRequest): Promise<string> {
  const response = await fetch(getCaptureUrl(input), {
    method: 'GET',
    signal: AbortSignal.timeout(30_000),
  })
  const data: unknown = await response.json()
  const parsed = microlinkResponseSchema.safeParse(data)

  if (!parsed.success || parsed.data.status !== 'success' || !parsed.data.data?.screenshot?.url) {
    throw getServiceError(response, parsed.success ? parsed.data : { status: 'invalid' })
  }

  return parsed.data.data.screenshot.url
}

function isSupportedImage(buffer: Buffer): boolean {
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8
  return isPng || isJpeg
}

async function downloadScreenshot(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) })

  if (!response.ok) {
    throw new Error(`Screenshot API returned ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) {
    throw new Error('Empty response from screenshot API')
  }
  if (!isSupportedImage(buffer)) {
    throw new Error('Invalid image format received from screenshot API: expected PNG or JPEG')
  }

  return buffer
}

function normalizeCaptureError(error: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error('timeout')
  }
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return new Error('connection_error')
  }
  if (error instanceof Error) {
    return error
  }

  return new Error('Screenshot service failed')
}

export async function captureScreenshot(input: ScreenshotRequest): Promise<ScreenshotCapture> {
  try {
    const screenshotUrl = await requestScreenshotUrl(input)
    const screenshot = (await downloadScreenshot(screenshotUrl)).toString('base64')
    return { screenshot, strategy: 'microlink' }
  } catch (error) {
    throw normalizeCaptureError(error)
  }
}

function includesAny(message: string, patterns: string[]): boolean {
  return patterns.some((pattern) => message.includes(pattern))
}

export function getScreenshotFailure(error: unknown): ScreenshotFailure {
  const message = error instanceof Error ? error.message : ''

  if (includesAny(message, ['timeout', 'Timeout'])) {
    return {
      message: 'Website took too long to load. Please try again or try a different URL.',
      status: 408,
    }
  }
  if (includesAny(message, ['connection_error', 'ECONNREFUSED'])) {
    return { message: 'Screenshot service is unavailable. Please try again later.', status: 503 }
  }
  if (includesAny(message, ['ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION'])) {
    return {
      message: 'Could not connect to the website. Please check the URL and try again.',
      status: 400,
    }
  }
  if (includesAny(message, ['SSL', 'certificate', 'ERR_CERT'])) {
    return {
      message: 'Website has SSL certificate issues. The screenshot may be incomplete.',
      status: 400,
    }
  }

  return {
    message:
      'Failed to capture screenshot. Please try again or contact support if the issue persists.',
    status: 500,
  }
}
