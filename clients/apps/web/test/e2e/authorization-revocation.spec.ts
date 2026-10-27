import { z } from 'zod'
import {
  acceptInvitation,
  getActiveOrganizationId,
  signUp,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { trpcMutation } from './framework/trpc'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabase, queryRow } from './framework/services'

const invitationSchema = z.object({ id: z.string() })

async function getMemberId(email: string, organizationId: string): Promise<string> {
  const database = createE2EDatabase()
  try {
    const user = await queryRow<{ id: string }>(
      database,
      'SELECT id FROM "user" WHERE email = $1',
      [email]
    )
    if (!user) {
      throw new Error('The invited user was not created.')
    }
    const member = await queryRow<{ id: string }>(
      database,
      'SELECT id FROM member WHERE "organizationId" = $1 AND "userId" = $2',
      [organizationId, user.id]
    )
    if (!member) {
      throw new Error('The invitation did not create a workspace member.')
    }
    return member.id
  } finally {
    await database.end()
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
    // Accepting navigates to /workspace by itself; a second goto here raced
    // it and aborted. The helper waits for that navigation instead.
    await acceptInvitation(memberPage, invitation.id)
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
          definition: {
            colors: { accent: '#7047eb', background: '#ffffff', text: '#111111' },
            schemaVersion: 1,
            typography: { headingFamily: 'inter' },
          },
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
