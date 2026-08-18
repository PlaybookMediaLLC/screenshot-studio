import { z } from 'zod'
import {
  getActiveOrganizationId,
  getE2EUrl,
  signUp,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { trpcMutation } from './framework/trpc'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabaseClient } from './framework/services'

const invitationSchema = z.object({ id: z.string() })

async function getMemberId(email: string, organizationId: string): Promise<string> {
  const database = createE2EDatabaseClient()
  try {
    const user = await database.user.findUnique({ select: { id: true }, where: { email } })
    if (!user) {
      throw new Error('The invited user was not created.')
    }
    const member = await database.member.findUnique({
      select: { id: true },
      where: { organizationId_userId: { organizationId, userId: user.id } },
    })
    if (!member) {
      throw new Error('The invitation did not create a workspace member.')
    }
    return member.id
  } finally {
    await database.$disconnect()
  }
}

configureE2EFlow()

test('a role downgrade denies privileged actions and member removal revokes the active session', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)
  const member = { ...identity, email: `authorization-${identity.email}`, name: 'E2E creator' }
  const invitation = invitationSchema.parse(
    (
      await requestJson(page, '/api/auth/organization/invite-member', {
        email: member.email,
        organizationId,
        role: 'creator',
      })
    ).body
  )
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()

  try {
    await signUp(member, memberPage)
    await memberPage.goto(getE2EUrl(`/accept-invitation?invitationId=${invitation.id}`))
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click()
    await expect
      .poll(async () => {
        try {
          await getMemberId(member.email, organizationId)
          return true
        } catch {
          return false
        }
      })
      .toBe(true)
    await memberPage.goto(getE2EUrl('/workspace'))
    const memberId = await getMemberId(member.email, organizationId)

    expect(
      (
        await requestJson(page, '/api/auth/organization/update-member-role', {
          memberId,
          organizationId,
          role: 'viewer',
        })
      ).status
    ).toBe(200)
    expect(
      (
        await trpcMutation(memberPage, 'brandKit.create', {
          definition: {},
          name: 'Denied after downgrade',
          publish: false,
        })
      ).status
    ).toBe(403)

    expect(
      (
        await requestJson(page, '/api/auth/organization/remove-member', {
          memberIdOrEmail: memberId,
          organizationId,
        })
      ).status
    ).toBe(200)
    const session = await browserRequest(memberPage, '/api/auth/get-session')
    expect(session.body).toBeNull()
    expect((await browserRequest(memberPage, '/api/tenant/releases')).status).toBe(401)
  } finally {
    await memberContext.close()
  }
})
