import { NextRequest, NextResponse } from 'next/server'
import { imageProxyRequestSchema } from '@/lib/api/schemas'

const ALLOWED_DOMAINS = [
  'pbs.twimg.com',
  'abs.twimg.com',
  'ton.twitter.com',
  'video.twimg.com',
]

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = getUrl(request)
  if (!url) {
    return NextResponse.json({ error: 'Missing or invalid url parameter' }, { status: 400 })
  }
  if (!isAllowedUrl(url)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 })
  }

  try {
    const response = await fetch(url)
    if (!response.ok) {
      return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
    }

    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Type': response.headers.get('content-type') || 'image/jpeg',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}
