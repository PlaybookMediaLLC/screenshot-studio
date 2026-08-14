'use client'

import { apiKeyClient } from '@better-auth/api-key/client'
import { scimClient } from '@better-auth/scim/client'
import { ssoClient } from '@better-auth/sso/client'
import { createAuthClient } from 'better-auth/react'
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { betterAuthOrganizationRoles } from './permissions'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    organizationClient({ roles: betterAuthOrganizationRoles }),
    apiKeyClient(),
    twoFactorClient({ twoFactorPage: '/two-factor' }),
    ssoClient(),
    scimClient(),
  ],
})
