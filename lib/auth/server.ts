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
import { sendAuthEmail } from './email'
import { assertSignInMethodAvailable, isPasswordAuthEnabled } from './methods'
import { betterAuthOrganizationRoles, isSupportedOrganizationRole } from './permissions'

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

type MemberHook = { member: { role: string } }
type RemovedMemberHook = { member: { organizationId: string; userId: string } }
type InvitationHook = { invitation: { role: string } }
type RoleUpdateHook = { newRole: string }

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
    admin({ adminRoles: [], defaultRole: 'user' }),
    organization({
      organizationHooks: {
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
        afterRemoveMember: async ({ member }: RemovedMemberHook) => {
          await prisma.session.deleteMany({
            where: { userId: member.userId },
          })
        },
      },
      requireEmailVerificationOnInvitation: requireEmailVerification,
      roles: betterAuthOrganizationRoles,
      sendInvitationEmail: async ({ invitation, organization, inviter }) => {
        const invitationUrl = new URL('/accept-invitation', getAuthBaseUrl())
        invitationUrl.searchParams.set('invitationId', invitation.id)
        await sendAuthEmail({
          subject: `Join ${organization.name} on Screenshot Studio`,
          text: `${inviter.user.name || inviter.user.email} invited you to ${organization.name}. Accept the invitation: ${invitationUrl}`,
          to: invitation.email,
        })
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
