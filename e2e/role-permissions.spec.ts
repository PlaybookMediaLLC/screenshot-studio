import { z } from 'zod'
import type { Browser, Page } from '@playwright/test'
import {
  acceptInvitation,
  getActiveOrganizationId,
  signUp,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test, type E2EIdentity } from './framework/flow'
import { trpcMutation, trpcQuery } from './framework/trpc'

const invitedRoles = ['admin', 'creator', 'approver', 'publisher', 'viewer'] as const
const invitationSchema = z.object({ id: z.string() })

type InvitedRole = (typeof invitedRoles)[number]

type RoleContext = {
  browser: Browser
  email: string
  identity: E2EIdentity
  organizationId: string
  ownerPage: Page
  role: InvitedRole
}

async function inviteRole(input: RoleContext): Promise<void> {
  const invitation = invitationSchema.parse(
    (
      await requestJson(input.ownerPage, '/api/auth/organization/invite-member', {
        email: input.email,
        organizationId: input.organizationId,
        role: input.role,
      })
    ).body
  )
  const context = await input.browser.newContext()
  const memberPage = await context.newPage()
  await signUp({ ...input.identity, email: input.email, name: `E2E ${input.role}` }, memberPage)
  await acceptInvitation(memberPage, invitation.id)

  await assertRolePermissions(memberPage, input.organizationId, input.role)
  await context.close()
}

async function assertRolePermissions(
  page: Page,
  organizationId: string,
  role: InvitedRole
): Promise<void> {
  const isAdmin = role === 'admin'
  const canCreateRelease = role === 'creator'
  const canManageWorkspace = isAdmin
  const canPublish = isAdmin || role === 'publisher'
  const [audit, brandKits, connections, releases, workspace] = await Promise.all([
    browserRequest(page, `/api/audit-logs?organizationId=${organizationId}`),
    trpcQuery(page, 'brandKit.list'),
    trpcQuery(page, 'channelConnection.list'),
    requestJson(
      page,
      '/api/tenant/releases',
      { benefitStatement: `Permission check for ${role}.`, title: `Role ${role} release` },
      'POST',
      { 'idempotency-key': `role-${role}-release` }
    ),
    trpcMutation(page, 'workspace.update', {
      name: `Denied ${role}`,
      slug: `denied-${role}-${organizationId.slice(-8).toLowerCase()}`,
    }),
  ])

  expect(audit.status).toBe(isAdmin ? 200 : 403)
  expect(brandKits.status).toBe(isAdmin ? 200 : 403)
  expect(connections.status).toBe(canPublish ? 200 : 403)
  expect(releases.status).toBe(canCreateRelease || isAdmin ? 201 : 403)
  expect(workspace.status).toBe(canManageWorkspace ? 200 : 403)
}

configureE2EFlow()

test('workspace roles permit only their assigned actions', async ({ browser, identity, page }) => {
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)

  for (const role of invitedRoles) {
    await inviteRole({
      browser,
      email: `${role}-${identity.email}`,
      identity,
      organizationId,
      ownerPage: page,
      role,
    })
  }
})
