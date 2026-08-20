import { getE2EUrl, openWorkspaceSetting, signUp, signUpAndCreateWorkspace } from './framework/auth'
import { trpcQuery } from './framework/trpc'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabaseClient } from './framework/services'

configureE2EFlow()

test('an owner can invite a viewer and remove their workspace access', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const memberIdentity = {
    ...identity,
    email: `member-${identity.email}`,
    name: 'E2E Viewer',
  }
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()

  try {
    await signUp(memberIdentity, memberPage)
    await openWorkspaceSetting(page, 'Members')
    await page.locator('input[name="email"]').fill(memberIdentity.email)
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText('Invitation created.')).toBeVisible()

    const database = createE2EDatabaseClient()
    const invitation = await database.invitation.findFirst({
      select: { id: true },
      where: { email: memberIdentity.email, status: 'pending' },
    })
    await database.$disconnect()
    if (!invitation) throw new Error('Invitation was not created.')

    await memberPage.goto(getE2EUrl(`/accept-invitation?invitationId=${invitation.id}`))
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click()
    await expect.poll(() => new URL(memberPage.url()).pathname).toBe('/workspace')

    await memberPage.goto(getE2EUrl('/'))
    await expect(memberPage.getByRole('button', { exact: true, name: 'Save' })).toBeVisible()
    expect((await trpcQuery(memberPage, 'apiKey.list')).status).toBe(403)

    await openWorkspaceSetting(page, 'Members')
    await expect(page.getByText(memberIdentity.email, { exact: true })).toBeVisible()
    const memberRow = page
      .getByText(memberIdentity.email, { exact: true })
      .locator('xpath=..')
      .locator('xpath=..')
    await memberRow.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText(memberIdentity.email, { exact: true })).toHaveCount(0)

    await memberPage.goto(getE2EUrl('/'))
    await expect.poll(() => new URL(memberPage.url()).pathname).toBe('/sign-in')
  } finally {
    await memberContext.close()
  }
})
