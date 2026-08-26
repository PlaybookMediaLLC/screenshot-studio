import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/errors'
import { imageProxyRequestSchema } from '@/lib/api/schemas'

const ALLOWED_DOMAINS = ['pbs.twimg.com', 'abs.twimg.com', 'ton.twitter.com', 'video.twimg.com']

function getUrl(request: NextRequest): URL | null {
  const parsed = imageProxyRequestSchema.safeParse({ url: request.nextUrl.searchParams.get('url') })
  if (!parsed.success) {
    return null
  }

  return new URL(parsed.data.url)
}

function isAllowedUrl(url: URL): boolean {
  return ALLOWED_DOMAINS.includes(url.hostname)
}

// Keep SSRF validation and response streaming in one auditable boundary.
// eslint-disable-next-line max-lines-per-function
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = getUrl(request)
  if (!url) {
    return apiError(
      400,
      'invalid_request',
      'Missing or invalid url parameter',
      `Append ?url= followed by an encoded absolute image URL on one of: ${ALLOWED_DOMAINS.join(', ')}.`
    )
  }
  if (!isAllowedUrl(url)) {
    return apiError(
      403,
      'forbidden_domain',
      'Domain not allowed',
      `This proxy only serves images from: ${ALLOWED_DOMAINS.join(', ')}.`
    )
  }

  try {
    const response = await fetch(url)
    if (!response.ok) {
      return apiError(
        502,
        'upstream_failed',
        'Upstream fetch failed',
        `The upstream host returned ${response.status}. Verify the image URL is still live, then retry.`
      )
    }

    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Type': response.headers.get('content-type') || 'image/jpeg',
      },
    })
  } catch {
    return apiError(
      500,
      'internal_error',
      'Failed to fetch image',
      'Check that the url parameter points to a live image, then retry.'
    )
  }
}
