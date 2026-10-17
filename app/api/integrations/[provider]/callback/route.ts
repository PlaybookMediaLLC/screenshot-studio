import { integrationCallbackContract } from '@/lib/api/contracts/integrations'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { checkState, clearState, redirectUri } from '@/lib/integrations/oauth'
import { exchangeCode, providerClient } from '@/lib/integrations/providers'
import { PROVIDER_NAMES, providerOfSlug, type ProviderSlug } from '@/lib/integrations/schema'
import { saveGrant } from '@/lib/integrations/server'
import { appOrigin } from '@/lib/sharing/page'

function back(slug: ProviderSlug, outcome: { connected: string } | { error: string }): Response {
  const url = new URL('/workspace/integrations', appOrigin())
  if ('connected' in outcome) url.searchParams.set('connected', outcome.connected)
  else url.searchParams.set('error', outcome.error)
  return new Response(null, {
    headers: { location: url.toString(), 'set-cookie': clearState(slug) },
    status: 302,
  })
}

/**
 * `GET /api/integrations/{provider}/callback`: check the state, trade the
 * code for tokens, seal them, and store the connection. Every outcome
 * returns to the workspace's integration settings with a message.
 */
export const GET = route(integrationCallbackContract, {
  auth: organizationAccess('workspace:update'),
  handler: async ({ access, params, query, request }) => {
    const provider = providerOfSlug(params.provider)
    const name = PROVIDER_NAMES[provider]
    if (query.error)
      return back(params.provider, { error: `${name} connection was cancelled (${query.error}).` })
    if (
      !query.code ||
      !checkState(
        request.headers.get('cookie'),
        params.provider,
        query.state,
        access.organizationId
      )
    ) {
      return back(params.provider, {
        error: `The ${name} connection expired or came from another session. Try again.`,
      })
    }
    const client = providerClient(provider)
    if (!client) return back(params.provider, { error: `${name} is not set up on this server.` })
    try {
      const grant = await exchangeCode(provider, client, query.code, redirectUri(params.provider))
      await saveGrant(access, provider, grant)
      return back(params.provider, { connected: `${name}: ${grant.displayName}` })
    } catch (error) {
      return back(params.provider, {
        error: error instanceof Error ? error.message : `${name} did not connect.`,
      })
    }
  },
})
