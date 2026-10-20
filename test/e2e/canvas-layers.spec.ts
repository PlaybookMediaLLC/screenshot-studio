import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { CanvasDocument } from '@/lib/canvas/document'
import { getActiveOrganizationId, getE2EUrl, signUpViaApi } from './framework/auth'
import { configureE2EFlow, expect, test, type E2EIdentity } from './framework/flow'
import { createE2EDatabase, grantWorkspacePlan } from './framework/services'
import { trpcMutation, trpcQuery } from './framework/trpc'

configureE2EFlow()
test.setTimeout(600_000)
test.use({ actionTimeout: 30_000, viewport: { width: 1600, height: 1000 } })

const out = path.resolve('.context/canvas-e2e')

async function setUp(identity: E2EIdentity, page: Page) {
  await signUpViaApi(identity, page)
  const created = await trpcMutation(page, 'workspace.create', {
    name: identity.workspaceName,
    slug: identity.email.split('@')[0],
  })
  expect(created.status).toBe(200)
  const organizationId = await getActiveOrganizationId(page)
  await grantWorkspacePlan(organizationId, 'pro')
  for (const route of [
    '/canvas',
    '/canvas/new',
    '/canvas/c000000000000000000000000',
    '/render/local',
  ])
    await page.request.get(getE2EUrl(route), { timeout: 180_000 })
  await mkdir(out, { recursive: true })
  return organizationId
}

async function saved(page: Page) {
  await expect(page.getByTestId('canvas-save-status')).toHaveText('Saved', { timeout: 60_000 })
}

async function stored(page: Page) {
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)!
  const result = await trpcQuery(page, 'canvas.get', { canvasId })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as { document: CanvasDocument }).document
}

async function openArtboard(page: Page, name: string) {
  // Leave any open artboard first: Escape steps out of text, groups, then the artboard.
  for (let step = 0; step < 4 && (await page.getByTestId('canvas-active-editor').count()); step++)
    await page.keyboard.press('Escape')
  await expect(page.getByTestId('canvas-active-editor')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Artboards' }).click()
  await page
    .getByRole('list', { name: 'Artboards' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await page.keyboard.press('Enter')
  await expect
    .poll(
      () =>
        page
          .getByTestId('canvas-active-editor')
          .evaluate((element) => getComputedStyle(element).opacity),
      { timeout: 120_000 }
    )
    .toBe('1')
  await page.getByRole('tab', { name: 'Insert' }).click()
}

const texts = (page: Page) => page.locator('#image-render-card [data-text-overlay-id]')
const text = (page: Page, value: string) => texts(page).filter({ hasText: value }).first()

/** Double-click a text layer and type over its words. */
async function typeInto(page: Page, value: string, typed: string) {
  await text(page, value).dblclick()
  const field = page.getByTestId('inline-text-editor')
  await expect(field).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(typed)
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(field).toBeHidden()
  await expect(text(page, typed)).toBeVisible()
}

test('F: layers group, move and take typed text; components keep overrides across artboards', async ({
  identity,
  page,
}) => {
  await setUp(identity, page)
  await page.goto(getE2EUrl('/canvas/new?blank=1'))
  await expect(page).toHaveURL(/\/canvas\/c[a-z0-9]{24}$/, { timeout: 180_000 })
  await expect(page.locator('[data-artboard-id]').first()).toBeVisible({ timeout: 120_000 })
  await openArtboard(page, '16:9')
  await page.getByRole('button', { name: 'Rounded rectangle', exact: true }).click()
  await saved(page)

  // A rounded rectangle is drawn with its radius and stored with it.
  const rounded = page.locator('#image-render-card [data-annotation-id] rect[rx]').last()
  await expect.poll(async () => Number(await rounded.getAttribute('rx'))).toBeGreaterThan(5)
  let artboard = (await stored(page)).artboards[0]!
  expect(artboard.document.annotations.at(-1)!.radius).toBe(0.2)

  // The text tool places a layer where you click and lets you type straight away.
  const stage = (await page.locator('#image-render-card').boundingBox())!
  for (const [y, words] of [
    [0.2, 'Ship faster'],
    [0.8, 'One queue for every launch'],
  ] as const) {
    await page.keyboard.press('t')
    await page.mouse.click(stage.x + stage.width * 0.25, stage.y + stage.height * y)
    await expect(page.getByTestId('inline-text-editor')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(words)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(text(page, words)).toBeVisible()
  }
  await saved(page)
  artboard = (await stored(page)).artboards[0]!
  const placed = artboard.document.texts.find(
    (layer) => layer.text === 'One queue for every launch'
  )
  expect(placed!.position.y).toBeGreaterThan(75)
  expect(placed!.position.x).toBeLessThan(30)

  // Shift-click selects several layers; ⌘G groups them.
  await text(page, 'Ship faster').click()
  await text(page, 'One queue for every launch').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('layer-selection')).toHaveAttribute('aria-label', '2 layers')
  await page.keyboard.press('ControlOrMeta+g')
  await saved(page)
  artboard = (await stored(page)).artboards[0]!
  expect(artboard.groups).toHaveLength(1)
  expect(artboard.groups[0]!.layers).toHaveLength(2)
  await expect(page.getByTestId('layer-selection')).toHaveAttribute('aria-label', 'Group 1')

  // Dragging one member moves the whole group as one edit.
  await page.keyboard.press('Escape')
  const grouped = (document: CanvasDocument['artboards'][number]['document']) =>
    ['Ship faster', 'One queue for every launch'].map(
      (words) => document.texts.find((layer) => layer.text === words)!.position
    )
  const before = grouped(artboard.document)
  const box = (await text(page, 'Ship faster').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  await saved(page)
  artboard = (await stored(page)).artboards[0]!
  const after = grouped(artboard.document)
  const shifts = after.map((position, index) => position.x - before[index]!.x)
  expect(shifts[0]).toBeGreaterThan(1)
  expect(Math.abs(shifts[0]! - shifts[1]!)).toBeLessThan(0.01)
  await page.screenshot({ path: path.join(out, 'f-group-moved.png') })

  // Double-click enters the group; double-clicking its text then types into it on the stage.
  await text(page, 'Ship faster').dblclick()
  await typeInto(page, 'Ship faster', 'Ship it faster')
  await saved(page)
  artboard = (await stored(page)).artboards[0]!
  expect(artboard.document.texts.map((layer) => layer.text)).toContain('Ship it faster')
  expect(artboard.groups).toHaveLength(1)
  await page.keyboard.press('Escape')

  // The group becomes a component; its layers become the first instance in place.
  await text(page, 'Ship it faster').click()
  await expect(page.getByTestId('layer-selection')).toHaveAttribute('aria-label', 'Group 1')
  await page.getByRole('button', { name: 'Create component' }).click()
  await page.getByLabel('Component name').fill('Hero copy')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await saved(page)
  let canvas = await stored(page)
  expect(canvas.components).toHaveLength(1)
  expect(canvas.artboards[0]!.instances).toHaveLength(1)
  await expect(page.getByTestId('layer-selection')).toHaveAttribute('aria-label', '◇ Hero copy')

  // Place it on a second artboard and override its headline there.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '1:1 · 1080 × 1080' }).click()
  await saved(page)
  await openArtboard(page, '1:1')
  await page
    .getByRole('list', { name: 'Components' })
    .getByRole('button', { name: 'Insert', exact: true })
    .click()
  await saved(page)
  canvas = await stored(page)
  const square = canvas.artboards.find((item) => item.name.startsWith('1:1'))!
  expect(square.instances).toHaveLength(1)
  await expect(text(page, 'Ship it faster')).toBeVisible()
  await text(page, 'Ship it faster').dblclick()
  await typeInto(page, 'Ship it faster', 'Local override')
  await saved(page)
  canvas = await stored(page)
  const overrides = canvas.artboards.find((item) => item.name.startsWith('1:1'))!.instances[0]!
    .overrides
  expect(Object.values(overrides)).toContainEqual({ text: 'Local override' })

  // Change the main component from the first artboard: the other line follows, the override stays.
  await openArtboard(page, '16:9')
  await text(page, 'One queue for every launch').dblclick()
  await typeInto(page, 'One queue for every launch', 'Every launch in one queue')
  await saved(page)
  // Escape steps out of the instance; a click then selects all of it.
  await page.keyboard.press('Escape')
  await text(page, 'Ship it faster').click()
  await expect(page.getByTestId('layer-selection')).toHaveAttribute('aria-label', '◇ Hero copy')
  await page.getByRole('button', { name: 'Update main component' }).click()
  await saved(page)
  canvas = await stored(page)
  expect(canvas.components[0]!.version).toBe(2)
  const copy = canvas.artboards
    .find((item) => item.name.startsWith('1:1'))!
    .document.texts.map((layer) => layer.text)
  expect(copy).toContain('Local override')
  expect(copy).toContain('Every launch in one queue')

  // Reset brings the main component's copy back to the override.
  await page.keyboard.press('Escape')
  await openArtboard(page, '1:1')
  await text(page, 'Local override').click()
  await expect(page.getByTestId('layer-selection')).toHaveAttribute('aria-label', '◇ Hero copy')
  await page.getByRole('button', { name: 'Reset overrides' }).click()
  await saved(page)
  await expect(text(page, 'Ship it faster')).toBeVisible()
  canvas = await stored(page)
  expect(
    canvas.artboards.find((item) => item.name.startsWith('1:1'))!.instances[0]!.overrides
  ).toEqual({})
  await page.screenshot({ path: path.join(out, 'f-components.png') })
})

test('G: members see who else is on a canvas and which artboard each is editing', async ({
  identity,
  page,
  browser,
}) => {
  const organizationId = await setUp(identity, page)
  await page.goto(getE2EUrl('/canvas/new?blank=1'))
  await expect(page).toHaveURL(/\/canvas\/c[a-z0-9]{24}$/, { timeout: 180_000 })
  await saved(page)
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(getE2EUrl('/')).origin,
          localStorage: [{ name: 'shots-consent', value: '{"analytics":false,"ads":false}' }],
        },
      ],
    },
  })
  try {
    const peer = await context.newPage()
    const email = `peer-${identity.email}`
    await signUpViaApi({ ...identity, email, name: 'Canvas colleague' }, peer)
    const database = createE2EDatabase()
    try {
      const user = await database.query('SELECT id FROM "user" WHERE email = $1', [email])
      await database.query(
        'INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())',
        [
          `c${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
          organizationId,
          user.rows[0].id,
          'creator',
        ]
      )
    } finally {
      await database.end()
    }
    expect((await trpcMutation(peer, 'workspace.setActive', { organizationId })).status).toBe(200)
    await peer.goto(page.url())
    await saved(peer)
    await expect(page.getByTestId('canvas-presence')).toContainText('Canvas colleague here', {
      timeout: 30_000,
    })

    // Opening an artboard shows the others a named ring on it.
    await openArtboard(peer, '16:9')
    await expect(page.getByTestId('peer-marker')).toHaveAttribute(
      'aria-label',
      /^Canvas colleague is editing 16:9/,
      { timeout: 30_000 }
    )
    await page.screenshot({ path: path.join(out, 'g-presence.png') })

    // The peer's saved work reaches this tab.
    await peer.keyboard.press('Escape')
    await peer.getByRole('button', { name: '1:1 · 1080 × 1080' }).click()
    await saved(peer)
    await expect(page.locator('[data-artboard-id]')).toHaveCount(2, { timeout: 30_000 })
    await peer.close()
    await expect(page.getByTestId('peer-marker')).toHaveCount(0, { timeout: 30_000 })
  } finally {
    await context.close()
  }
})
