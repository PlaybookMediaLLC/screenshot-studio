import { apiKey } from '@better-auth/api-key'
import { dash } from '@better-auth/infra'
import { scim } from '@better-auth/scim'
import { sso } from '@better-auth/sso'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { betterAuth } from 'better-auth'
import { organization, twoFactor } from 'better-auth/plugins'
import { prisma } from '@/lib/db'
import {
  getAuthBaseUrl,
  getAuthSecret,
  getBetterAuthInfrastructure,
  getSocialProviderCredentials,
  getTrustedOrigins,
} from './environment'
import { sendAuthEmail } from './email'
import { betterAuthOrganizationRoles, isSupportedOrganizationRole } from './permissions'

const google = getSocialProviderCredentials('GOOGLE')
const github = getSocialProviderCredentials('GITHUB')
const microsoft = getSocialProviderCredentials('MICROSOFT')
const infrastructure = getBetterAuthInfrastructure()

const socialProviders = {
  ...(google ? { google } : {}),
  ...(github ? { github } : {}),
  ...(microsoft ? { microsoft } : {}),
}

type MemberHook = { member: { role: string } }
type InvitationHook = { invitation: { role: string } }
type RoleUpdateHook = { newRole: string }

export const auth = betterAuth({
  baseURL: getAuthBaseUrl(),
  database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
  emailAndPassword: {
    autoSignIn: process.env.NODE_ENV !== 'production',
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: process.env.NODE_ENV === 'production',
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ url, user }) =>
      sendAuthEmail({
        subject: 'Reset your Screenshot Studio password',
        text: url,
        to: user.email,
      }),
  },
  emailVerification: {
    sendOnSignIn: true,
    sendVerificationEmail: async ({ url, user }) =>
      sendAuthEmail({ subject: 'Verify your Screenshot Studio email', text: url, to: user.email }),
  },
  plugins: [
    organization({
      beforeAddMember: async ({ member }: MemberHook) => {
        if (!isSupportedOrganizationRole(member.role)) {
          throw new Error('Unsupported organization role.')
        }
      },
      beforeCreateInvitation: async ({ invitation }: InvitationHook) => {
        if (!isSupportedOrganizationRole(invitation.role)) {
          throw new Error('Unsupported organization role.')
        }
      },
      beforeUpdateMemberRole: async ({ newRole }: RoleUpdateHook) => {
        if (!isSupportedOrganizationRole(newRole)) {
          throw new Error('Unsupported organization role.')
        }
      },
      requireEmailVerificationOnInvitation: true,
      roles: betterAuthOrganizationRoles,
    }),
    apiKey({
      defaultPrefix: 'ss_',
      enableSessionForAPIKeys: false,
      permissions: {
        defaultPermissions: {
          artifact: ['read'],
          asset: ['write'],
          release: ['create'],
          source: ['write'],
          upload: ['sign'],
        },
      },
      rateLimit: { enabled: true, maxRequests: 60, timeWindow: 60_000 },
      references: 'organization',
    }),
    twoFactor({
      accountLockout: { durationSeconds: 900, maxFailedAttempts: 10 },
      issuer: 'Screenshot Studio',
      trustDeviceMaxAge: 30 * 24 * 60 * 60,
    }),
    sso({
      domainVerification: { enabled: true },
      organizationProvisioning: { defaultRole: 'member' },
      providersLimit: 3,
    }),
    scim({
      canGenerateToken: ({ organizationId }) => Boolean(organizationId),
      linkExistingUsers: { requireExistingOrgMembership: true },
      providerOwnership: { enabled: true },
      requiredRole: ['owner'],
      storeSCIMToken: 'hashed',
    }),
    ...(infrastructure ? [dash(infrastructure)] : []),
  ],
  secret: getAuthSecret(),
  session: { freshAge: 15 * 60 },
  socialProviders,
  trustedOrigins: getTrustedOrigins(),
})
