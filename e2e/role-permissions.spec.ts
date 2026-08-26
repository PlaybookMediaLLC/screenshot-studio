import { z } from 'zod'
import type { Browser, Page } from '@playwright/test'
import {
  acceptInvitation,
  getActiveOrganizationId,
  signUpAndCreateWorkspace,
  signUpViaApi,
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

async function inviteRole(input: RoleContext & { invitationId: string }): Promise<void> {
  const context = await input.browser.newContext()
  try {
    const memberPage = await context.newPage()
    // This spec asserts what each role may do, not how the account was
    // created, so invited members are created through the API. The sign-up
    // form stays covered by the specs that exist to exercise it.
    await signUpViaApi(
      { ...input.identity, email: input.email, name: `E2E ${input.role}` },
      memberPage
    )
    await acceptInvitation(memberPage, input.invitationId)
    await assertRolePermissions(memberPage, input.organizationId, input.role)
  } finally {
    // Without this the context leaks whenever an assertion fails, and the
    // abandoned browser competes for resources with the roles still to
    // run, which turns one slow role into a cascade of timeouts.
    await context.close()
  }
}

/**
 * Create the invitation on the owner's page.
 *
 * Kept separate from inviteRole, and never run concurrently, because every
 * helper here issues its request through `page.evaluate` so it carries the
 * session cookie. Two of these in flight on the same owner page share one
 * execution context, so anything that replaces that context rejects the
 * in-flight call with "Execution context was destroyed" no matter what the
 * endpoint would have returned. This is a POST, so browserRequest
 * deliberately does not retry it: a replayed invite could create a second
 * invitation.
 */
async function createInvitation(input: RoleContext): Promise<string> {
  const invitation = invitationSchema.parse(
    (
      await requestJson(input.ownerPage, '/api/auth/organization/invite-member', {
        email: input.email,
        organizationId: input.organizationId,
        role: input.role,
      })
    ).body
  )
  return invitation.id
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
  const [audit, brandKits, connections, invitation, releases, workspace] = await Promise.all([
    browserRequest(page, `/api/audit-logs?organizationId=${organizationId}`),
    trpcQuery(page, 'brandKit.list'),
    trpcQuery(page, 'channelConnection.list'),
    trpcMutation(page, 'workspace.invite', {
      email: `invited-by-${role}-${organizationId}@example.test`,
      role: 'viewer',
    }),
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
  expect(invitation.status).toBe(isAdmin ? 200 : 403)
  expect(releases.status).toBe(canCreateRelease || isAdmin ? 201 : 403)
  expect(workspace.status).toBe(canManageWorkspace ? 200 : 403)
}

configureE2EFlow()

test('workspace roles permit only their assigned actions', async ({ browser, identity, page }) => {
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)

  // Roles are independent, so they run in pairs rather than one at a
  // time. Serially this was five sign-up and invitation round trips inside
  // a single test budget, which made the spec fail on accumulated latency
  // rather than on a permission regression. Running all five at once
  // instead would put five browser contexts on a two-core runner, so the
  // batch size trades a little wall time for stability.
  //
  // The invitations are created first, one at a time. They all run on the
  // owner's page, and concurrent page.evaluate calls there share a single
  // execution context, which is how this spec produced the "Execution
  // context was destroyed" flake. Only the per-role work below, which each
  // own a separate browser context, still runs in parallel.
  const invitations = new Map<InvitedRole, string>()
  for (const role of invitedRoles) {
    invitations.set(
      role,
      await createInvitation({
        browser,
        email: `${role}-${identity.email}`,
        identity,
        organizationId,
        ownerPage: page,
        role,
      })
    )
  }

  const concurrency = 2
  for (let index = 0; index < invitedRoles.length; index += concurrency) {
    await Promise.all(
      invitedRoles.slice(index, index + concurrency).map((role) => {
        const invitationId = invitations.get(role)
        if (!invitationId) throw new Error(`No invitation was created for the ${role} role.`)
        return inviteRole({
          browser,
          email: `${role}-${identity.email}`,
          identity,
          invitationId,
          organizationId,
          ownerPage: page,
          role,
        })
      })
    )
  }
})
