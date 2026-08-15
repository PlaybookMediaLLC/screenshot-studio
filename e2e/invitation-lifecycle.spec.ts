import { z } from 'zod'
import { getE2EUrl, openWorkspaceSetting, signUp, signUpAndCreateWorkspace } from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test, type E2EIdentity } from './framework/flow'
import { createE2EDatabaseClient } from './framework/services'

const invitationSchema = z.object({ id: z.string() })
const sessionSchema = z.object({
  session: z.object({ activeOrganizationId: z.string().nullable() }),
})

function getMemberIdentity(identity: E2EIdentity, prefix: string): E2EIdentity {
  return { ...identity, email: `${prefix}-${identity.email}`, name: `${prefix} recipient` }
}

async function createInvitation(page: Parameters<typeof openWorkspaceSetting>[0], email: string) {
  await openWorkspaceSetting(page, 'Members')
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/auth/organization/invite-member')
  )
  await page.locator('input[name="email"]').fill(email)
  await page.getByRole('button', { name: 'Invite' }).click()
  return invitationSchema.parse(await (await responsePromise).json())
}

async function expectNoActiveWorkspace(
  page: Parameters<typeof openWorkspaceSetting>[0]
): Promise<void> {
  const response = await browserRequest(page, '/api/auth/get-session')
  const session = sessionSchema.parse(response.body)
  expect(session.session.activeOrganizationId).toBeNull()
}

async function expectInvitationRejection(
  page: Parameters<typeof openWorkspaceSetting>[0],
  invitationId: string
): Promise<void> {
  await page.goto(getE2EUrl(`/accept-invitation?invitationId=${invitationId}`))
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/accept-invitation')
  await expect(page.locator('p.text-destructive')).toBeVisible()
  await expectNoActiveWorkspace(page)
}

async function expireInvitation(invitationId: string): Promise<void> {
  const database = createE2EDatabaseClient()
  try {
    await database.invitation.update({
      data: { expiresAt: new Date(Date.now() - 60_000) },
      where: { id: invitationId },
    })
  } finally {
    await database.$disconnect()
  }
}

configureE2EFlow()

test('an invitation accepts once for its intended recipient', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const member = getMemberIdentity(identity, 'accepted')
  const invitation = await createInvitation(page, member.email)
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()

  try {
    await signUp(member, memberPage)
    await memberPage.goto(getE2EUrl(`/accept-invitation?invitationId=${invitation.id}`))
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click()
    await expect.poll(() => new URL(memberPage.url()).pathname).toBe('/workspace')
    await memberPage.goto(getE2EUrl(`/accept-invitation?invitationId=${invitation.id}`))
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(memberPage.locator('p.text-destructive')).toBeVisible()
  } finally {
    await memberContext.close()
  }
})

test('an invitation cannot be accepted by another user or after cancellation', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const intendedMember = getMemberIdentity(identity, 'intended')
  const invitation = await createInvitation(page, intendedMember.email)
  const otherContext = await browser.newContext()
  const intendedContext = await browser.newContext()

  try {
    const otherPage = await otherContext.newPage()
    await signUp(getMemberIdentity(identity, 'other'), otherPage)
    await expectInvitationRejection(otherPage, invitation.id)
    expect(
      (
        await requestJson(page, '/api/auth/organization/cancel-invitation', {
          invitationId: invitation.id,
        })
      ).status
    ).toBe(200)

    const intendedPage = await intendedContext.newPage()
    await signUp(intendedMember, intendedPage)
    await expectInvitationRejection(intendedPage, invitation.id)
  } finally {
    await intendedContext.close()
    await otherContext.close()
  }
})

test('an expired invitation does not grant workspace access', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const member = getMemberIdentity(identity, 'expired')
  const invitation = await createInvitation(page, member.email)
  await expireInvitation(invitation.id)
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()

  try {
    await signUp(member, memberPage)
    await expectInvitationRejection(memberPage, invitation.id)
  } finally {
    await memberContext.close()
  }
})
