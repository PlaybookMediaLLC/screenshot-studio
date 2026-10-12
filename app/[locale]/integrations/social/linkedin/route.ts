import type { NextRequest } from 'next/server'

// LinkedIn redirects here after the Go backend creates a one-use OAuth state.
// The state is verified and consumed by that backend, which owns the social
// connection and its credentials.
export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  if (!code || !state || request.nextUrl.searchParams.has('error')) {
    return new Response('LinkedIn connection was not completed.', { status: 400 })
  }

  const configuredURL = process.env.POSTIZ_API_URL
  if (!configuredURL) {
    return new Response('LinkedIn connection is not configured.', { status: 503 })
  }

  let callbackURL: URL
  try {
    callbackURL = new URL('/integrations/social-connect/linkedin', configuredURL)
  } catch {
    return new Response('LinkedIn connection is not configured.', { status: 503 })
  }

  try {
    const result = await fetch(callbackURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state, timezone: '0' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (!result.ok) {
      return new Response('LinkedIn connection failed. Please start again.', { status: 502 })
    }
    return new Response('LinkedIn connected to Screenshot Studio Backend.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch {
    return new Response('LinkedIn connection failed. Please start again.', { status: 502 })
  }
}
