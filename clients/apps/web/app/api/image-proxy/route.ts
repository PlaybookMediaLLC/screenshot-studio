import { NextRequest, NextResponse } from 'next/server'
import { imageProxyRequestSchema } from '@/lib/api/schemas'
import { apiError } from '@/lib/api/errors'
import { requirePaidAccess } from '@/lib/api/require-account'
import { fetchProxyImage, IMAGE_PROXY_HOSTS, isAllowedProxyImage } from '@/lib/image-proxy'

const ALLOWED_DOMAINS = IMAGE_PROXY_HOSTS

function getUrl(request: NextRequest): URL | null {
  const parsed = imageProxyRequestSchema.safeParse({ url: request.nextUrl.searchParams.get('url') })
  if (!parsed.success) {
    return null
  }

  return new URL(parsed.data.url)
}

// Keep the validation, upstream fetch, and response hardening together so the
// proxy's SSRF boundary remains reviewable as one path.
// eslint-disable-next-line max-lines-per-function
export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = await requirePaidAccess(request)
  if (denied) return denied

  const url = getUrl(request)
  if (!url) {
    return apiError(
      400,
      'invalid_request',
      'Missing or invalid url parameter',
      `Append an encoded absolute image URL hosted on: ${ALLOWED_DOMAINS.join(', ')}.`
    )
  }
  if (!isAllowedProxyImage(url)) {
    return apiError(
      403,
      'forbidden_domain',
      'Domain not allowed',
      `This proxy only serves images from: ${ALLOWED_DOMAINS.join(', ')}.`
    )
  }

  try {
    const response = await fetchProxyImage(url)
    if (!response.ok) {
      return apiError(
        502,
        'upstream_failed',
        'Upstream fetch failed',
        'Use an HTTPS image on an allowed host, under 10 MB. Redirects must stay on allowed hosts.'
      )
    }

    return new NextResponse(new Uint8Array(response.bytes), {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': response.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return apiError(
      500,
      'internal_error',
      'Failed to fetch image',
      'Check that the url parameter is a valid absolute URL, then retry.'
    )
  }
}
