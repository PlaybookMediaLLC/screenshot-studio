import { NextRequest, NextResponse } from 'next/server'
import { getClientIdentifier } from '@/lib/api/client-identity'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { screenshotRequestSchema, type ScreenshotRequest } from '@/lib/api/schemas'
import { SCREENSHOT_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { apiError, methodNotAllowed } from '@/lib/api/errors'
import { checkRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import {
  cacheScreenshot,
  getCachedScreenshot,
  invalidateCache,
  normalizeUrl,
} from '@/lib/screenshot-cache'
import {
  assertPublicCaptureUrl,
  captureScreenshot,
  getScreenshotFailure,
} from '@/lib/screenshot-service'

export const maxDuration = 60

function getRateLimitHeaders(rateLimit: RateLimitResult): Record<string, string> {
  const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))
  return {
    'Retry-After': retryAfter.toString(),
    'X-RateLimit-Limit': rateLimit.limit.toString(),
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': rateLimit.resetAt.toString(),
  }
}

async function getRateLimitResponse(request: NextRequest): Promise<NextResponse | null> {
  try {
    const rateLimit = await checkRateLimit(
      getClientIdentifier(request.headers),
      SCREENSHOT_RATE_LIMIT
    )
    if (rateLimit.allowed) {
      return null
    }

    return apiError(
      429,
      'rate_limited',
      'Rate limit exceeded. Please try again later.',
      `Wait ${Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))} seconds, then retry.`,
      undefined,
      getRateLimitHeaders(rateLimit)
    )
  } catch (error) {
    console.error('Rate limit check failed:', error)
    return apiError(
      503,
      'upstream_unavailable',
      'Rate limiting is unavailable. Please try again shortly.',
      'Retry later. Requests fail closed while rate limiting is unavailable.'
    )
  }
}

function getCacheKey(url: string, input: ScreenshotRequest): string {
  return `${url}:${input.deviceType}:${input.colorScheme}`
}

async function refreshCache(input: ScreenshotRequest, url: string): Promise<void> {
  if (!input.forceRefresh) {
    return
  }

  try {
    await invalidateCache(url)
  } catch (error) {
    console.warn('Failed to invalidate cache:', error)
  }
}

async function loadCachedScreenshot(input: ScreenshotRequest, url: string): Promise<string | null> {
  if (input.forceRefresh) {
    return null
  }

  try {
    return await getCachedScreenshot(getCacheKey(url, input))
  } catch (error) {
    console.warn('Cache check failed:', error)
    return null
  }
}

async function storeScreenshot(
  input: ScreenshotRequest,
  url: string,
  screenshot: string
): Promise<void> {
  try {
    await cacheScreenshot(getCacheKey(url, input), screenshot)
  } catch (error) {
    console.warn('Failed to cache screenshot:', error)
  }
}

type ScreenshotResponseInput = {
  cached: boolean
  input: ScreenshotRequest
  screenshot: string
  strategy?: 'microlink'
  url: string
}

function screenshotResponse(response: ScreenshotResponseInput): NextResponse {
  return NextResponse.json({
    cached: response.cached,
    colorScheme: response.input.colorScheme,
    deviceType: response.input.deviceType,
    screenshot: response.screenshot,
    strategy: response.strategy,
    url: response.url,
  })
}

// Keep rate limiting, validation, capture, and stable error translation in the
// order requests execute so the public boundary is straightforward to audit.
// eslint-disable-next-line max-lines-per-function
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await getRateLimitResponse(request)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const input = await parseJson(request, screenshotRequestSchema)
    assertPublicCaptureUrl(input.url)
    const url = normalizeUrl(input.url)
    await refreshCache(input, url)
    const cachedScreenshot = await loadCachedScreenshot(input, url)
    if (cachedScreenshot) {
      return screenshotResponse({ cached: true, input, screenshot: cachedScreenshot, url })
    }

    const capture = await captureScreenshot({ ...input, url })
    await storeScreenshot(input, url, capture.screenshot)
    return screenshotResponse({
      cached: false,
      input,
      screenshot: capture.screenshot,
      strategy: capture.strategy,
      url,
    })
  } catch (error) {
    console.error('Screenshot error:', error)
    if (isInvalidRequest(error)) {
      return apiError(
        400,
        'invalid_request',
        'Invalid screenshot request',
        'Send an absolute public http or https URL and supported device and color scheme values.'
      )
    }

    const failure = getScreenshotFailure(error)
    return apiError(
      failure.status,
      'upstream_failed',
      failure.message,
      'Verify the target is publicly reachable, then retry.'
    )
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
