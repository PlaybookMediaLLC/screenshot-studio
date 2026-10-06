import { getActiveOrganizationId, getE2EUrl, signUpAndCreateWorkspace } from './framework/auth'
import { trpcQuery } from './framework/trpc'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabaseClient } from './framework/services'

configureE2EFlow()

async function createDesign(organizationId: string) {
  const database = createE2EDatabaseClient()
  try {
    return await database.design.create({
      data: {
        document: {
          annotations: [{ end: { x: 0.4, y: 0.5 }, start: { x: 0.2, y: 0.3 }, type: 'arrow' }],
          image: { src: '/demo/notion-showcase.webp' },
          template: 'template-midnight-focus',
          texts: [{ fontSize: 0.04, position: { x: 50, y: 8 }, text: 'Opened from a design' }],
          version: 1,
        },
        name: 'E2E design',
        organizationId,
      },
      select: { id: true },
    })
  } finally {
    await database.$disconnect()
  }
}

test('a stored design opens in the editor with its layers editable', async ({ identity, page }) => {
  await signUpAndCreateWorkspace(identity, page)
  const design = await createDesign(await getActiveOrganizationId(page))

  await page.goto(getE2EUrl(`/?design=${design.id}`))
  await expect(page.getByText('Opened “E2E design”')).toBeVisible({ timeout: 60_000 })
  const canvas = page.locator('[data-html-canvas="true"]')
  await expect(canvas.getByText('Opened from a design')).toBeVisible()
  await expect(canvas.locator('[data-text-overlay-id]')).toHaveCount(1)
  // The parameter is dropped so a refresh keeps later edits.
  expect(new URL(page.url()).searchParams.has('design')).toBe(false)
})

test('designs stay inside their workspace and the render page needs a token', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const design = await createDesign(await getActiveOrganizationId(page))

  expect((await page.goto(getE2EUrl(`/render/${design.id}`)))?.status()).toBe(404)
  expect((await page.goto(getE2EUrl(`/render/${design.id}?token=forged.token`)))?.status()).toBe(
    404
  )

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  try {
    await signUpAndCreateWorkspace(
      {
        ...identity,
        email: `other-${identity.email}`,
        workspaceName: `Other ${identity.workspaceName}`,
      },
      otherPage
    )
    expect((await trpcQuery(otherPage, 'design.get', { designId: design.id })).status).toBe(404)
  } finally {
    await otherContext.close()
  }
})
