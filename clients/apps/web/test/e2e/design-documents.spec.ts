import { randomUUID } from 'node:crypto'
import {
  createWorkspace,
  db,
  expect,
  getActiveOrganizationId,
  getE2EUrl,
  test,
  trpcQuery,
} from './framework'

test.use({ workspaceOptions: { plan: 'pro' } })

async function createDesign(organizationId: string) {
  // cuid-shaped: design routes accept lowercase alphanumeric ids only.
  const id = `c${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const document = {
    annotations: [{ end: { x: 0.4, y: 0.5 }, start: { x: 0.2, y: 0.3 }, type: 'arrow' }],
    image: { src: '/demo/notion-showcase.webp' },
    template: 'template-midnight-focus',
    texts: [{ fontSize: 0.04, position: { x: 50, y: 8 }, text: 'Opened from a design' }],
    version: 1,
  }
  await db.query(
    `INSERT INTO design (id, "organizationId", name, document, "updatedAt")
       VALUES ($1, $2, 'E2E design', $3::jsonb, now())`,
    [id, organizationId, JSON.stringify(document)]
  )
  return { id }
}

test('a stored design opens in the editor with its layers editable', async ({ app, page }) => {
  const design = await createDesign(await getActiveOrganizationId(page))

  await app.open(`/?design=${design.id}`)
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
  const design = await createDesign(await getActiveOrganizationId(page))

  expect((await page.goto(getE2EUrl(`/render/${design.id}`)))?.status()).toBe(404)
  expect((await page.goto(getE2EUrl(`/render/${design.id}?token=forged.token`)))?.status()).toBe(
    404
  )

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  try {
    await createWorkspace(
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
