'use client'

import { apiKeyClient } from '@better-auth/api-key/client'
import { scimClient } from '@better-auth/scim/client'
import { ssoClient } from '@better-auth/sso/client'
import { createAuthClient } from 'better-auth/react'
import { useSyncExternalStore } from 'react'
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { betterAuthOrganizationRoles } from './permissions'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    organizationClient({ roles: betterAuthOrganizationRoles }),
    apiKeyClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        const callbackURL = new URLSearchParams(window.location.search).get('callbackURL')
        const search = callbackURL ? `?callbackURL=${encodeURIComponent(callbackURL)}` : ''
        window.location.assign(`/two-factor${search}`)
      },
    }),
    ssoClient(),
    scimClient(),
  ],
})

const subscribeToNothing = () => () => {}

/**
 * The session for client components that also render on the server. Better
 * Auth's store can fill before React hydrates, while the server always renders
 * it as pending; reporting pending until hydration keeps the first client
 * render identical to the server's.
 */
export function useHydratedSession(): ReturnType<typeof authClient.useSession> {
  const session = authClient.useSession()
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )
  return hydrated ? session : { ...session, data: null, isPending: true }
}
