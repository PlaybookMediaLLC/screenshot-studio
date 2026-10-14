/** Typed client for the Screenshot Studio Go backend. Instantiate on a trusted server. */

export type BackendScope = {
  organizationId: string
  requestId: string
  sessionId: string
  userId: string
}

export type ScheduledPost = {
  caption: string
  channelConnection?: {
    externalAccountId: string
    platform: string
    provider: string
  }
  channelConnectionId: string
  createdAt: string
  id: string
  scheduledFor: string
  status:
    'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN_DELIVERY'
  variantId: string
}

export type ChannelConnection = {
  createdAt: string
  externalAccountId: string
  id: string
  platform: string
  provider: string
  providerSettings: Record<string, unknown>
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED'
}

export type OAuthProvider = 'x' | 'instagram' | 'instagram-standalone'

export class BackendSDKError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503
  ) {
    super(message)
    this.name = 'BackendSDKError'
  }
}

export class ScreenshotStudioBackendSDK {
  private readonly baseURL: string

  constructor(
    baseURL: string,
    private readonly serviceToken: string,
    private readonly scope: BackendScope,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!baseURL || !serviceToken || !scope.sessionId) {
      throw new BackendSDKError('Publishing backend is not configured.', 503)
    }
    this.baseURL = `${baseURL.replace(/\/$/, '')}/`
  }

  private async request<T>(path: string, init: { body?: unknown; method?: 'GET' | 'POST' } = {}) {
    let response: Response
    try {
      response = await this.fetcher(new URL(path, this.baseURL), {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          'content-type': 'application/json',
          'x-organization-id': this.scope.organizationId,
          'x-request-id': this.scope.requestId,
          'x-session-id': this.scope.sessionId,
          'x-user-id': this.scope.userId,
        },
        method: init.method ?? 'GET',
      })
    } catch {
      throw new BackendSDKError('Publishing backend is unavailable.', 503)
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null
      const status =
        ([400, 401, 403, 404, 409, 429] as const).find((value) => value === response.status) ?? 503
      throw new BackendSDKError(error?.error ?? 'Publishing request failed.', status)
    }
    return (await response.json()) as T
  }

  async listScheduledPosts(limit: number) {
    return this.request<{ items: ScheduledPost[] }>(`v1/scheduled-posts?limit=${limit}`)
  }

  async createScheduledPost(input: {
    caption: string
    channelConnectionId: string
    idempotencyKey: string
    scheduledFor: Date
    variantId: string
  }) {
    return this.request<{ created: boolean; scheduledPost: ScheduledPost }>('v1/scheduled-posts', {
      body: input,
      method: 'POST',
    })
  }

  async cancelScheduledPost(id: string) {
    return this.request<ScheduledPost>(`v1/scheduled-posts/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    })
  }

  async listConnections() {
    return this.request<{ items: ChannelConnection[] }>('v1/channel-connections')
  }

  async createConnection(input: {
    externalAccountId: string
    platform: string
    providerSettings: Record<string, unknown>
    secretReference: string
  }) {
    return this.request<ChannelConnection>('v1/channel-connections', {
      body: input,
      method: 'POST',
    })
  }

  async beginSocialOAuth(provider: OAuthProvider) {
    return this.request<{ url: string }>('v1/social-oauth/begin', {
      body: { provider },
      method: 'POST',
    })
  }

  async verifySocialOAuth(provider: OAuthProvider, state: string, integrationId?: string) {
    return this.request('v1/social-oauth/verify', {
      body: { provider, state, integrationId },
      method: 'POST',
    })
  }

  async rememberInstagramIntegration(state: string, integrationId: string) {
    return this.request('v1/social-oauth/remember', {
      body: { provider: 'instagram', state, integrationId },
      method: 'POST',
    })
  }

  async completeSocialOAuth(provider: OAuthProvider, state: string, integrationId: string) {
    return this.request('v1/social-oauth/complete', {
      body: { provider, state, integrationId },
      method: 'POST',
    })
  }
}
