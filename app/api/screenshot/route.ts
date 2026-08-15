import { NextRequest, NextResponse } from 'next/server'
import { isInvalidRequest, parseJson } from '@/lib/api/request'
import { screenshotRequestSchema, type ScreenshotRequest } from '@/lib/api/schemas'
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

const RATE_LIMIT = 20

function getClientIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  return forwardedFor?.split(',', 1)[0] || request.headers.get('x-real-ip') || 'unknown'
}

function getRateLimitHeaders(rateLimit: RateLimitResult): HeadersInit {
  const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))
  return {
    'Retry-After': retryAfter.toString(),
    'X-RateLimit-Limit': RATE_LIMIT.toString(),
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': rateLimit.resetAt.toString(),
  }
}

async function getRateLimitResponse(request: NextRequest): Promise<NextResponse | null> {
  try {
    const rateLimit = await checkRateLimit(getClientIdentifier(request))
    if (rateLimit.allowed) {
      return null
    }

    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { headers: getRateLimitHeaders(rateLimit), status: 429 }
    )
  } catch (error) {
    console.error('Rate limit check failed:', error)
    return NextResponse.json(
      { error: 'Rate limiting is unavailable. Please try again shortly.' },
      { status: 503 }
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
      return NextResponse.json({ error: 'Invalid screenshot request' }, { status: 400 })
    }

    const failure = getScreenshotFailure(error)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
}
