import { z } from 'zod'
import {
  acceptInvitation,
  enableTwoFactor,
  getActiveOrganizationId,
  openWorkspaceSetting,
  signUp,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabaseClient } from './framework/services'
import { trpcMutation } from './framework/trpc'

const apiKeySchema = z.object({ apiKey: z.object({ key: z.string().min(1) }) })
const workspaceCreateResponseSchema = z.object({ organization: z.object({ id: z.string() }) })

async function getInvitationId(email: string): Promise<string> {
  const database = createE2EDatabaseClient()
  try {
    const invitation = await database.invitation.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      where: { email, status: 'pending' },
    })
    if (!invitation) throw new Error('Invitation was not created.')
    return invitation.id
  } finally {
    await database.$disconnect()
  }
}

async function getMember(email: string): Promise<{ id: string; role: string }> {
  const database = createE2EDatabaseClient()
  try {
    const member = await database.member.findFirst({
      select: { id: true, role: true },
      where: { user: { is: { email } } },
    })
    if (!member) throw new Error('Workspace member was not found.')
    return member
  } finally {
    await database.$disconnect()
  }
}

async function getReleaseOutboxEvent(organizationId: string) {
  const database = createE2EDatabaseClient()
  try {
    const event = await database.outboxEvent.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { attempts: true, deliveredAt: true },
      where: { aggregateType: 'release', organizationId, type: 'release.created' },
    })
    if (!event) throw new Error('Release outbox event was not created.')
    return event
  } finally {
    await database.$disconnect()
  }
}

configureE2EFlow()

test('ownership transfer preserves an owner and prevents the former owner from transferring', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const owner = await getMember(identity.email)
  expect((await trpcMutation(page, 'workspace.leave', {})).status).toBe(409)
  expect((await trpcMutation(page, 'workspace.removeMember', { memberId: owner.id })).status).toBe(
    409
  )

  const memberIdentity = { ...identity, email: `owner-${identity.email}`, name: 'New owner' }
  const memberContext = await browser.newContext()
  try {
    await openWorkspaceSetting(page, 'Members')
    await page.locator('input[name="email"]').fill(memberIdentity.email)
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText('Invitation created.')).toBeVisible()
    const invitationId = await getInvitationId(memberIdentity.email)

    const memberPage = await memberContext.newPage()
    await signUp(memberIdentity, memberPage)
    await acceptInvitation(memberPage, invitationId)

    await enableTwoFactor(page, identity.password)
    await openWorkspaceSetting(page, 'Members')
    const memberRow = page
      .getByText(memberIdentity.email, { exact: true })
      .locator('xpath=..')
      .locator('xpath=..')
    await memberRow.getByRole('button', { name: 'Make owner' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Transfer ownership' }).click()
    await expect(page.getByText('Ownership transferred.')).toBeVisible()

    const newOwner = await getMember(memberIdentity.email)
    expect(newOwner.role).toBe('owner')
    expect((await getMember(identity.email)).role).toBe('admin')
    expect(
      (await trpcMutation(page, 'workspace.transferOwnership', { memberId: newOwner.id })).status
    ).toBe(403)
  } finally {
    await memberContext.close()
  }
})

test('an MFA-protected owner can schedule and restore workspace deletion', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)
  const recoveryWorkspaceName = `${identity.workspaceName} recovery`
  workspaceCreateResponseSchema.parse(
    (
      await trpcMutation(page, 'workspace.create', {
        name: recoveryWorkspaceName,
        slug: `recovery-${organizationId.slice(-8).toLowerCase()}`,
      })
    ).body
  )
  expect((await trpcMutation(page, 'workspace.setActive', { organizationId })).status).toBe(200)
  expect(
    (
      await requestJson(page, '/api/tenant/releases', {
        benefitStatement: 'Verify suspension pauses queued work.',
        title: 'Deletion recovery release',
      })
    ).status
  ).toBe(201)
  const apiKey = apiKeySchema.parse(
    (
      await trpcMutation(page, 'apiKey.create', {
        name: 'Deletion check',
        scopes: ['artifact:read'],
      })
    ).body
  ).apiKey.key
  expect(
    (
      await trpcMutation(page, 'workspace.requestDeletion', {
        confirmation: identity.workspaceName,
      })
    ).status
  ).toBe(403)

  await enableTwoFactor(page, identity.password)
  await openWorkspaceSetting(page, 'General')
  await page.locator('input[name="confirmation"]').fill(identity.workspaceName)
  await page.getByRole('button', { name: 'Schedule deletion' }).click()
  await expect(page.getByRole('heading', { name: 'Workspace deletion is scheduled' })).toBeVisible()
  await page.goto('/')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/workspace')
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: `Switch to ${recoveryWorkspaceName}` }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: `Switch to ${identity.workspaceName}` }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/workspace')
  await expect(page.getByRole('heading', { name: 'Workspace deletion is scheduled' })).toBeVisible()
  expect((await browserRequest(page, '/api/tenant/releases')).status).toBe(403)
  expect((await browserRequest(page, '/api/auth/organization/get-active-member')).status).toBe(403)
  expect(
    (await browserRequest(page, '/api/tenant/releases', { headers: { 'x-api-key': apiKey } }))
      .status
  ).toBe(403)
  expect(
    (
      await requestJson(
        page,
        '/api/internal/tenant-outbox/dispatch',
        {},
        'POST',
        getMaintenanceHeaders()
      )
    ).status
  ).toBe(200)
  expect(await getReleaseOutboxEvent(organizationId)).toMatchObject({
    attempts: 0,
    deliveredAt: null,
  })

  await page.getByRole('button', { name: 'Restore workspace' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/workspace')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  expect((await browserRequest(page, '/api/tenant/releases')).status).toBe(200)
  expect(
    (
      await requestJson(
        page,
        '/api/internal/tenant-outbox/dispatch',
        {},
        'POST',
        getMaintenanceHeaders()
      )
    ).status
  ).toBe(200)
  expect(await getReleaseOutboxEvent(organizationId)).toMatchObject({
    attempts: 1,
    deliveredAt: expect.any(Date),
  })
})

test('member mutations cannot target another workspace membership', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const otherIdentity = {
    ...identity,
    email: `other-workspace-${identity.email}`,
    name: 'Other workspace owner',
    workspaceName: `Other ${identity.workspaceName}`,
  }
  const otherContext = await browser.newContext()
  try {
    const otherPage = await otherContext.newPage()
    await signUpAndCreateWorkspace(otherIdentity, otherPage)
    const otherMember = await getMember(otherIdentity.email)
    expect(
      (await trpcMutation(page, 'workspace.removeMember', { memberId: otherMember.id })).status
    ).toBe(404)
    expect(
      (
        await trpcMutation(page, 'workspace.updateMemberRole', {
          memberId: otherMember.id,
          role: 'viewer',
        })
      ).status
    ).toBe(404)
  } finally {
    await otherContext.close()
  }
})
