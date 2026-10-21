import { mkdir } from 'node:fs/promises'
import type { Route } from '@playwright/test'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { DESIGN_DOCUMENT_VERSION } from '@/lib/design/document'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getActiveOrganizationId, getE2EUrl, signUpViaApi } from './framework/auth'
import { createE2EDatabase, grantWorkspacePlan } from './framework/services'
import { chooseOption } from './framework/controls'
import { trpcMutation, trpcQuery } from './framework/trpc'

configureE2EFlow({
  beforeEach: async ({ identity, page }) => {
    await signUpViaApi(identity, page)
    expect(
      (
        await trpcMutation(page, 'workspace.create', {
          name: identity.workspaceName,
          slug: identity.email.split('@')[0],
        })
      ).status
    ).toBe(200)
    const organizationId = await getActiveOrganizationId(page)
    await grantWorkspacePlan(organizationId, 'pro')
    const database = createE2EDatabase()
    try {
      await database.query(
        `UPDATE workspace_entitlement SET "featureOverrides" = $2::jsonb WHERE "organizationId" = $1`,
        [organizationId, JSON.stringify({ 'creative-sets:create': false })]
      )
    } finally {
      await database.end()
    }
  },
})
test.setTimeout(180_000)

const listRoute = '**/api/trpc/**creativeSet.list**'

test('restricted members can request access, preview formats and keep working in Projects', async ({
  page,
}) => {
  for (const name of ['Launch', 'Product update']) {
    expect(
      (
        await trpcMutation(page, 'project.create', {
          name,
          document: { version: DESIGN_DOCUMENT_VERSION, image: { src: null } },
        })
      ).status
    ).toBe(200)
  }
  await page.goto(getE2EUrl('/creative-sets'))
  await expect(page).toHaveTitle(/Story Sets/)
  await expect(page.getByRole('link', { name: 'Request design-partner access' })).toHaveAttribute(
    'href',
    '/contact'
  )
  await expect(page.getByRole('link', { name: 'View Projects' })).toHaveAttribute(
    'href',
    '/projects'
  )
  await expect(page.getByText(/You have 2 saved projects/)).toBeVisible()
  await expect(page.getByLabel('Example Story Set')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Story Set' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No Story Sets yet' })).toBeVisible()
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
  expect(
    await sidebar.getByRole('link', { name: 'Story Sets', exact: true }).locator('svg').innerHTML()
  ).not.toBe(
    await sidebar.getByRole('link', { name: 'Assets', exact: true }).locator('svg').innerHTML()
  )
  await mkdir('.context', { recursive: true })
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' })
  await page.screenshot({ path: '.context/story-sets-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('link', { name: 'Request design-partner access' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await page.screenshot({ path: '.context/story-sets-mobile.png', fullPage: true })

  const story = createCreativeSet({
    headline: 'Plan your week',
    supporting: '',
    treatment: 'product-hero',
    source: {
      id: 'source',
      src: 'asset:11111111-1111-4111-8111-111111111111',
      name: 'test.png',
      revision: 1,
      width: 1440,
      height: 900,
    },
    focus: { x: 0, y: 0, width: 1, height: 1 },
  })
  // A schema-valid payload reaches the real entitlement check before asset storage.
  const id = `c${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
  const denied = await trpcMutation(page, 'creativeSet.create', {
    id,
    name: 'Denied',
    document: story,
  })
  expect(denied.status).toBe(403)
  expect(await trpcQuery(page, 'creativeSet.get', { creativeSetId: id })).toMatchObject({
    status: 404,
  })
  expect((await trpcQuery(page, 'creativeSet.list', {})).body).toMatchObject({ items: [] })
})

test('unknown and malformed links stop loading and provide a way back', async ({ page }) => {
  for (const id of [
    'clxxxxxxxxxxxxxxxxxxxxxxx',
    'does-not-exist-123',
    '11111111-1111-4111-8111-111111111111',
  ]) {
    const missing = await trpcQuery(page, 'creativeSet.get', { creativeSetId: id })
    expect(missing).toMatchObject({ status: 404, body: { message: 'Story Set not found.' } })
    await page.goto(getE2EUrl(`/creative-sets/${id}`))
    await expect(page.getByRole('heading', { name: 'Story Set not found' })).toBeVisible()
    await expect(page.getByText('Opening Story Set…')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Back to Story Sets' })).toHaveAttribute(
      'href',
      '/creative-sets'
    )
  }
  await page.getByRole('link', { name: 'Back to Story Sets' }).click()
  await expect(page.getByRole('heading', { name: 'Story Sets', exact: true })).toBeVisible()
})

test('failed list requests hide the empty state and can be retried', async ({ page }) => {
  const fail = (route: Route) => route.abort('internetdisconnected')
  await page.route(listRoute, fail)
  await page.goto(getE2EUrl('/creative-sets'))
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'We couldn’t load your Story Sets.'
  )
  await expect(page.getByRole('heading', { name: 'No Story Sets yet' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search Story Sets' }).fill('launch')
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'We couldn’t load your Story Sets.'
  )
  await expect(page.getByRole('heading', { name: 'No matching Story Sets' })).toHaveCount(0)
  await page.unroute(listRoute, fail)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('No Story Sets match “launch”.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('heading', { name: 'No Story Sets yet' })).toBeVisible()
})

test('search and sorting survive navigation and long or blank queries are safe', async ({
  page,
}) => {
  await page.goto(getE2EUrl('/creative-sets'))
  const search = page.getByRole('searchbox', { name: 'Search Story Sets' })
  await expect(page.getByRole('heading', { name: 'No Story Sets yet' })).toBeVisible()
  let listRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('creativeSet.list')) listRequests++
  })
  await search.fill('   ')
  await page.waitForTimeout(400)
  expect(listRequests).toBe(0)
  await search.fill('  launch  ')
  await expect(page.getByText('No Story Sets match “launch”.')).toBeVisible()
  await chooseOption(page.getByRole('combobox', { name: 'Sort Story Sets' }), 'Name')
  await expect(page).toHaveURL(/sort=name/)
  await page.getByRole('link', { name: 'View Projects' }).click()
  await expect(page).toHaveTitle(/Projects/)
  await page.goBack()
  await expect(search).toHaveValue('  launch  ')
  await expect(page.getByRole('combobox', { name: 'Sort Story Sets' })).toContainText('Name')
  await search.fill('x'.repeat(201))
  await expect(search).toHaveValue('x'.repeat(200))
  await expect(page.getByRole('heading', { name: 'No matching Story Sets' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await page.goto(getE2EUrl(`/creative-sets?search=${'y'.repeat(201)}`))
  await expect(search).toHaveValue('y'.repeat(200))
  await expect(page.getByRole('heading', { name: 'No matching Story Sets' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
})

test('a detail network failure offers Retry without an endless loading message', async ({
  page,
}) => {
  const fail = (route: Route) => route.abort('internetdisconnected')
  const route = '**/api/trpc/**creativeSet.get**'
  await page.route(route, fail)
  await page.goto(getE2EUrl('/creative-sets/clxxxxxxxxxxxxxxxxxxxxxxx'))
  await expect(page.getByRole('heading', { name: 'Could not open this Story Set' })).toBeVisible()
  await expect(page.getByText('Opening Story Set…')).toHaveCount(0)
  await page.unroute(route, fail)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Story Set not found' })).toBeVisible()
})
