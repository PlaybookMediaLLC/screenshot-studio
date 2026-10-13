import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const providers = ['x', 'instagram', 'instagram-standalone'] as const
export type SocialOAuthProvider = (typeof providers)[number]

export type SocialOAuthCompletion = {
  onConnected?: (state: string, integrationId: string) => Promise<void>
  onPageChoice?: (state: string, integrationId: string) => Promise<void>
}

export type InstagramSelection = {
  beforeSelect?: (state: string, integrationId: string) => Promise<void>
  onSelected?: (state: string, integrationId: string) => Promise<void>
}

const pageSchema = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  name: z.string().nullable().optional(),
})
const connectionSchema = z.object({
  id: z.string().min(1),
  pages: z.array(pageSchema).optional(),
})
const pageChoiceSchema = z.object({
  accountId: z.string().min(1),
  expiresAt: z.number().int(),
  integrationId: z.string().min(1),
  pageId: z.string().min(1),
  state: z.string().min(1),
})

function isProvider(value: string): value is SocialOAuthProvider {
  return providers.some((provider) => provider === value)
}

function backendURL(path: string): URL | null {
  const configured = process.env.POSTIZ_API_URL
  if (!configured) return null
  try {
    return new URL(path, configured)
  } catch {
    return null
  }
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function pickerSecret(): string | null {
  return process.env.BETTER_AUTH_SECRET || null
}

function signChoice(choice: z.infer<typeof pageChoiceSchema>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(choice)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyChoice(value: string, secret: string): z.infer<typeof pageChoiceSchema> | null {
  const [payload, signature, extra] = value.split('.')
  if (!payload || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  let received: Buffer
  try {
    received = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const choice = pageChoiceSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
    return choice.expiresAt > Date.now() ? choice : null
  } catch {
    return null
  }
}

function connectionFailed(provider: SocialOAuthProvider): Response {
  return new Response(`${provider} connection failed. Please start again.`, { status: 502 })
}

export async function completeSocialOAuth(
  request: Request,
  providerName: string,
  completion: SocialOAuthCompletion = {}
): Promise<Response> {
  if (!isProvider(providerName)) return new Response('Provider not found.', { status: 404 })
  const params = new URL(request.url).searchParams
  if (params.has('error') || params.has('denied')) {
    return new Response(`${providerName} connection was not completed.`, { status: 400 })
  }

  const state = providerName === 'x' ? params.get('oauth_token') : params.get('state')
  const code = providerName === 'x' ? params.get('oauth_verifier') : params.get('code')
  if (
    !state ||
    !code ||
    (providerName === 'x' && params.has('state') && params.get('state') !== state)
  ) {
    return new Response(`${providerName} connection was not completed.`, { status: 400 })
  }
  const callbackURL = backendURL(`/integrations/social-connect/${providerName}`)
  if (!callbackURL) return new Response('Social connection is not configured.', { status: 503 })

  try {
    const result = await fetch(callbackURL, {
      body: JSON.stringify({ code, state, timezone: '0' }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    })
    if (!result.ok) return connectionFailed(providerName)
    const connected = connectionSchema.safeParse(await result.json())
    if (!connected.success) return connectionFailed(providerName)
    if (providerName !== 'instagram') {
      await completion.onConnected?.(state, connected.data.id)
      return new Response(`${providerName} connected to Screenshot Studio Backend.`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const pages = connected.data.pages ?? []
    if (pages.length === 0) {
      return new Response('No linked Instagram professional account was found.', { status: 409 })
    }
    await completion.onPageChoice?.(state, connected.data.id)
    const secret = pickerSecret()
    if (!secret) return new Response('Social connection is not configured.', { status: 503 })
    const options = pages
      .map((page) => {
        const value = signChoice(
          {
            accountId: page.id,
            expiresAt: Date.now() + 10 * 60 * 1000,
            integrationId: connected.data.id,
            pageId: page.pageId,
            state,
          },
          secret
        )
        return `<label><input type="radio" name="choice" value="${htmlEscape(value)}" required> ${htmlEscape(page.name || page.id)}</label>`
      })
      .join('<br>')
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>Select Instagram account</title></head><body><main><h1>Select an Instagram account</h1><form method="post">${options}<br><button type="submit">Connect account</button></form></main></body></html>`,
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'none'; form-action 'self'; base-uri 'none'",
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      }
    )
  } catch {
    return connectionFailed(providerName)
  }
}

export async function selectInstagramAccount(
  request: Request,
  selection: InstagramSelection = {}
): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin !== new URL(request.url).origin)
    return new Response('Invalid origin.', { status: 403 })
  const secret = pickerSecret()
  if (!secret) return new Response('Social connection is not configured.', { status: 503 })
  const data = await request.formData().catch(() => null)
  const rawChoice = data?.get('choice')
  const choice = typeof rawChoice === 'string' ? verifyChoice(rawChoice, secret) : null
  if (!choice)
    return new Response('Account selection expired. Please start again.', { status: 400 })
  await selection.beforeSelect?.(choice.state, choice.integrationId)
  const callbackURL = backendURL(
    `/integrations/public/provider/${encodeURIComponent(choice.integrationId)}/connect`
  )
  if (!callbackURL) return new Response('Social connection is not configured.', { status: 503 })
  try {
    const result = await fetch(callbackURL, {
      body: JSON.stringify({ id: choice.accountId, pageId: choice.pageId, state: choice.state }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    })
    if (!result.ok) return connectionFailed('instagram')
    await selection.onSelected?.(choice.state, choice.integrationId)
    return new Response('Instagram connected to Screenshot Studio Backend.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch {
    return connectionFailed('instagram')
  }
}
