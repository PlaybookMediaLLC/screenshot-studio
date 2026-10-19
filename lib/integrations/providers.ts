import { z } from 'zod'
import type { Credentials } from './crypto'
import type { IntegrationProvider } from './schema'

/**
 * Each provider's OAuth: where to send the user, how to trade the code for
 * tokens, and how to refresh them. Client IDs and secrets come from the
 * environment; a provider without them is shown as not set up.
 */

/** Tokens and the account they belong to, after an exchange or a refresh. */
export type Grant = {
  credentials: Credentials
  displayName: string
  /** ISO time the access token expires, or null when it does not. */
  expiresAt: string | null
  externalId: string
  scopes: string[]
}

type Fetch = typeof fetch

type ProviderDefinition = {
  /** Scopes requested at connect time. */
  scopes: readonly string[]
  authorizeUrl: (clientId: string, redirectUri: string, state: string) => string
  exchange: (client: Client, code: string, redirectUri: string, fetcher: Fetch) => Promise<Grant>
  /** Refresh an expiring token; absent when the provider's tokens do not expire. */
  refresh?: (
    client: Client,
    grant: Pick<Grant, 'credentials' | 'displayName' | 'externalId' | 'scopes'>,
    fetcher: Fetch
  ) => Promise<Grant>
}

type Client = { id: string; secret: string }

/** A provider answered with an error the user can act on. */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** True when the connection must be made again (revoked or expired access). */
    readonly reconnect = false
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

const expiry = (seconds: number | undefined) =>
  seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null

async function json(response: Response, provider: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `${provider} answered ${response.status}.`
    throw new ProviderError(message, response.status === 401)
  }
  return body
}

const basic = (client: Client) =>
  `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`

const notionToken = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  workspace_id: z.string(),
  workspace_name: z.string().nullable().optional(),
})

function notionGrant(body: unknown): Grant {
  const token = notionToken.parse(body)
  return {
    credentials: { accessToken: token.access_token, refreshToken: token.refresh_token },
    displayName: token.workspace_name || 'Notion workspace',
    expiresAt: expiry(token.expires_in),
    externalId: token.workspace_id,
    scopes: [],
  }
}

const figmaToken = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
})
const figmaMe = z.object({ email: z.string().optional(), handle: z.string(), id: z.string() })

const PROVIDERS: Record<Exclude<IntegrationProvider, 'SLACK'>, ProviderDefinition> = {
  NOTION: {
    authorizeUrl: (clientId, redirectUri, state) =>
      `https://api.notion.com/v1/oauth/authorize?${new URLSearchParams({
        client_id: clientId,
        owner: 'user',
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
      })}`,
    exchange: async (client, code, redirectUri, fetcher) =>
      notionGrant(
        await json(
          await fetcher('https://api.notion.com/v1/oauth/token', {
            body: JSON.stringify({
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }),
            headers: { authorization: basic(client), 'content-type': 'application/json' },
            method: 'POST',
          }),
          'Notion'
        )
      ),
    refresh: async (client, grant, fetcher) => {
      if (!grant.credentials.refreshToken)
        throw new ProviderError('Notion access expired. Connect Notion again.', true)
      return notionGrant(
        await json(
          await fetcher('https://api.notion.com/v1/oauth/token', {
            body: JSON.stringify({
              grant_type: 'refresh_token',
              refresh_token: grant.credentials.refreshToken,
            }),
            headers: { authorization: basic(client), 'content-type': 'application/json' },
            method: 'POST',
          }),
          'Notion'
        )
      )
    },
    scopes: [],
  },
  FIGMA: {
    authorizeUrl: (clientId, redirectUri, state) =>
      `https://www.figma.com/oauth?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: PROVIDERS.FIGMA.scopes.join(' '),
        state,
      })}`,
    exchange: async (client, code, redirectUri, fetcher) => {
      const token = figmaToken.parse(
        await json(
          await fetcher('https://api.figma.com/v1/oauth/token', {
            body: new URLSearchParams({
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }),
            headers: { authorization: basic(client) },
            method: 'POST',
          }),
          'Figma'
        )
      )
      const me = figmaMe.parse(
        await json(
          await fetcher('https://api.figma.com/v1/me', {
            headers: { authorization: `Bearer ${token.access_token}` },
          }),
          'Figma'
        )
      )
      return {
        credentials: { accessToken: token.access_token, refreshToken: token.refresh_token },
        displayName: me.handle,
        expiresAt: expiry(token.expires_in),
        externalId: me.id,
        scopes: [...PROVIDERS.FIGMA.scopes],
      }
    },
    refresh: async (client, grant, fetcher) => {
      if (!grant.credentials.refreshToken)
        throw new ProviderError('Figma access expired. Connect Figma again.', true)
      const token = figmaToken.parse(
        await json(
          await fetcher('https://api.figma.com/v1/oauth/refresh', {
            body: new URLSearchParams({ refresh_token: grant.credentials.refreshToken }),
            headers: { authorization: basic(client) },
            method: 'POST',
          }),
          'Figma'
        )
      )
      return {
        ...grant,
        credentials: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? grant.credentials.refreshToken,
        },
        expiresAt: expiry(token.expires_in),
      }
    },
    scopes: ['current_user:read', 'file_comments:write'],
  },
}

/** The provider's client credentials from the environment, or null when it is not set up. */
export function providerClient(provider: IntegrationProvider): Client | null {
  if (provider === 'SLACK') return null
  const id = process.env[`${provider}_CLIENT_ID`]
  const secret = process.env[`${provider}_CLIENT_SECRET`]
  return id && secret ? { id, secret } : null
}

/** The environment variables a provider needs. */
export function providerEnvironment(provider: IntegrationProvider): string[] {
  if (provider === 'SLACK') return ['backend Slack configuration']
  return [`${provider}_CLIENT_ID`, `${provider}_CLIENT_SECRET`]
}

/** The provider's consent screen URL. */
export function authorizeUrl(
  provider: IntegrationProvider,
  client: Client,
  redirectUri: string,
  state: string
): string {
  if (provider === 'SLACK') throw new ProviderError('Slack is managed by the backend.')
  return PROVIDERS[provider].authorizeUrl(client.id, redirectUri, state)
}

/** Trade an authorization code for tokens and the account they belong to. */
export function exchangeCode(
  provider: IntegrationProvider,
  client: Client,
  code: string,
  redirectUri: string,
  fetcher: Fetch = fetch
): Promise<Grant> {
  if (provider === 'SLACK') throw new ProviderError('Slack is managed by the backend.')
  return PROVIDERS[provider].exchange(client, code, redirectUri, fetcher)
}

/** Refresh credentials, or null when the provider's tokens do not expire. */
export function refreshGrant(
  provider: IntegrationProvider,
  client: Client,
  grant: Pick<Grant, 'credentials' | 'displayName' | 'externalId' | 'scopes'>,
  fetcher: Fetch = fetch
): Promise<Grant> | null {
  if (provider === 'SLACK') throw new ProviderError('Slack is managed by the backend.')
  return PROVIDERS[provider].refresh?.(client, grant, fetcher) ?? null
}
