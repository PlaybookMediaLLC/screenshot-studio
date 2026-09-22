import { INDEXNOW_KEY, submitSitemapToIndexNow } from '@/lib/seo/indexnow'

export async function GET(): Promise<Response> {
  if (!INDEXNOW_KEY) {
    return new Response('Not Found', { status: 404 })
  }

  return new Response(INDEXNOW_KEY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}

export async function POST(request: Request): Promise<Response> {
  if (!INDEXNOW_KEY) {
    return Response.json(
      { code: 'not_configured', message: 'INDEXNOW_KEY is not set.' },
      { status: 503 }
    )
  }

  if (request.headers.get('authorization') !== `Bearer ${INDEXNOW_KEY}`) {
    return Response.json(
      { code: 'unauthorized', message: 'Send Authorization: Bearer <INDEXNOW_KEY>.' },
      { status: 401 }
    )
  }

  const result = await submitSitemapToIndexNow()
  return Response.json(result, { status: result.ok ? 200 : 502 })
}
