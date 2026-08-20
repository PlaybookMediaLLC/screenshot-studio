import { apiKey } from '@better-auth/api-key'
import { dash } from '@better-auth/infra'
import { scim } from '@better-auth/scim'
import { sso } from '@better-auth/sso'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { betterAuth } from 'better-auth'
import { admin, organization, twoFactor } from 'better-auth/plugins'
import { prisma } from '@/lib/db'
import {
  getAuthBaseUrl,
  getAuthSecret,
  getBetterAuthInfrastructure,
  getSocialProviderCredentials,
  getTrustedOrigins,
} from './environment'
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './transactional-email'
import { assertSignInMethodAvailable, isPasswordAuthEnabled } from './methods'
import { organizationHooks } from './organization-hooks'
import { betterAuthOrganizationRoles } from './permissions'

const google = getSocialProviderCredentials('GOOGLE')
const github = getSocialProviderCredentials('GITHUB')
const microsoft = getSocialProviderCredentials('MICROSOFT')
const infrastructure = getBetterAuthInfrastructure()
const requireEmailVerification =
  process.env.NODE_ENV === 'production' && process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false'
const passwordAuthEnabled = isPasswordAuthEnabled()

assertSignInMethodAvailable()

const socialProviders = {
  ...(google ? { google } : {}),
  ...(github ? { github } : {}),
  ...(microsoft ? { microsoft } : {}),
}

export const auth = betterAuth({
  baseURL: getAuthBaseUrl(),
  database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
  emailAndPassword: {
    autoSignIn: process.env.NODE_ENV !== 'production',
    enabled: passwordAuthEnabled,
    minPasswordLength: 12,
    requireEmailVerification,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ url, user }) =>
      sendPasswordResetEmail({ actionUrl: url, to: user.email }),
  },
  emailVerification: {
    sendOnSignIn: true,
    sendVerificationEmail: async ({ url, user }) =>
      sendVerificationEmail({ actionUrl: url, to: user.email }),
  },
  plugins: [
    admin({ adminRoles: [], defaultRole: 'user' }),
    organization({
      disableOrganizationDeletion: true,
      invitationExpiresIn: 7 * 24 * 60 * 60,
      organizationHooks,
      requireEmailVerificationOnInvitation: requireEmailVerification,
      roles: betterAuthOrganizationRoles,
      sendInvitationEmail: async ({ invitation, organization, inviter }) => {
        const invitationUrl = new URL('/accept-invitation', getAuthBaseUrl())
        invitationUrl.searchParams.set('invitationId', invitation.id)
        // The invitation row already exists by this point, and it can be
        // accepted from the members screen without the email. Letting a
        // mail failure propagate would fail the whole invite request and
        // leave an invitation the caller believes was never created.
        try {
          await sendInvitationEmail({
            acceptUrl: invitationUrl.toString(),
            inviterName: inviter.user.name || inviter.user.email,
            organizationName: organization.name,
            to: invitation.email,
          })
        } catch (error) {
          console.error('Invitation email delivery failed.', {
            invitationId: invitation.id,
            organizationId: organization.id,
            reason: error instanceof Error ? error.message : 'unknown',
          })
        }
      },
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
  // A database-backed session must be checked on every request so a removed
  // member cannot keep using a signed cookie cache until it expires.
  session: { cookieCache: { enabled: false }, freshAge: 15 * 60 },
  socialProviders,
  trustedOrigins: getTrustedOrigins(),
})
