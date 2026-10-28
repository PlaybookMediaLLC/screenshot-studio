import { createHash, createHmac } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import {
  chooseOption,
  db,
  type E2EIdentity,
  expect,
  getActiveOrganizationId,
  getE2EUrl,
  grantWorkspacePlan,
  type Page,
  requestJson,
  signUpViaApi,
  test,
  trpcMutation,
  trpcQuery,
  uploadSignedAsset,
} from './framework'
import type { CanvasDocument } from '@/lib/canvas/document'

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
  await expect(page.getByTestId('canvas-save-status')).toHaveText('Saved to workspace', {
    timeout: 60_000,
  })
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
  app,
  identity,
  page,
}) => {
  await setUp(identity, page)
  await app.open('/canvas/new?blank=1')
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
  app,
  browser,
  identity,
  page,
}) => {
  const organizationId = await setUp(identity, page)
  await app.open('/canvas/new?blank=1')
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
    const user = await db.query('SELECT id FROM "user" WHERE email = $1', [email])
    await db.query(
      'INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())',
      [
        `c${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
        organizationId,
        user.rows[0].id,
        'creator',
      ]
    )
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

test('H: App Store screenshot groups sit on the canvas, edit in the store editor and export store sizes', async ({
  app,
  identity,
  page,
}) => {
  await setUp(identity, page)
  await app.open('/canvas/new?blank=1')
  await expect(page).toHaveURL(/\/canvas\/c[a-z0-9]{24}$/, { timeout: 180_000 })
  await saved(page)
  await page.getByRole('button', { name: /^App Store screenshots/ }).click()
  await page.getByRole('button', { name: 'New store screenshot group' }).click()
  await expect(page.getByRole('dialog', { name: 'Add App Store screenshots' })).toBeHidden({
    timeout: 120_000,
  })
  await saved(page)
  let canvas = await stored(page)
  expect(canvas.storeGroups).toHaveLength(1)
  const item = canvas.storeGroups[0]!
  expect(item.targetId).toBe('ios-iphone-6.9')
  expect(item.group.document.slides).toHaveLength(1)
  // Every store asset lives in workspace storage.
  for (const asset of Object.values(item.group.document.assets)) {
    expect(asset.src).toBeNull()
    expect(item.group.assetMap[asset.id]).toMatch(/^asset:/)
  }
  const group = page.locator(`[data-store-group-id="${item.group.id}"]`)
  await expect(group).toBeVisible()
  await expect(page.getByTestId('store-group-panel')).toBeVisible()

  // The device size sets how the slides sit on the plane.
  await chooseOption(page.getByLabel('Store device size'), 'App Store · iPad 13"')
  await saved(page)
  expect((await stored(page)).storeGroups[0]!.targetId).toBe('ios-ipad-13')

  // Drag the group by its label.
  const label = (await group.locator('[data-store-group-label]').boundingBox())!
  await page.mouse.move(label.x + 10, label.y + 6)
  await page.mouse.down()
  await page.mouse.move(label.x + 90, label.y + 46, { steps: 8 })
  await page.mouse.up()
  await saved(page)
  canvas = await stored(page)
  expect(canvas.storeGroups[0]!.x).toBeGreaterThan(item.x)

  // The store editor edits the native store document; the canvas saves it.
  await group.dblclick()
  const editor = page.getByTestId('canvas-store-editor')
  await expect(editor).toBeVisible({ timeout: 60_000 })
  await editor.getByRole('button', { name: 'Duplicate slide' }).click()
  await expect(editor.getByLabel(/^Slide 2 of 2/)).toBeVisible()

  // Export writes every slide at the store's own pixel size.
  await editor.getByRole('button', { name: 'Export store sizes' }).click()
  const exporting = page.getByRole('dialog', { name: 'Export screenshots' })
  const download = page.waitForEvent('download', { timeout: 180_000 })
  await exporting.getByRole('button', { name: /^Export \d+ files?$/ }).click()
  const file = path.join(out, (await download).suggestedFilename())
  await (await download).saveAs(file)
  const zip = await JSZip.loadAsync(await readFile(file))
  const images = Object.keys(zip.files).filter((name) => name.endsWith('.png'))
  expect(images.length).toBeGreaterThanOrEqual(2)
  const first = await sharp(await zip.files[images[0]!]!.async('nodebuffer')).metadata()
  expect([first.width, first.height]).toEqual(expect.arrayContaining([expect.any(Number)]))
  expect(first.width! * first.height!).toBeGreaterThan(1_000_000)
  await page.keyboard.press('Escape')
  await editor.getByRole('button', { name: 'Done' }).click()
  await expect(editor).toBeHidden()
  await saved(page)
  canvas = await stored(page)
  expect(canvas.storeGroups[0]!.group.document.slides).toHaveLength(2)
  await expect(group.locator('.bg-white')).toHaveCount(2)
  await page.screenshot({ path: path.join(out, 'h-store-group.png') })

  // Reload: the group, its size and both slides come back.
  await app.reload()
  await expect(page.locator(`[data-store-group-id="${item.group.id}"] .bg-white`)).toHaveCount(2, {
    timeout: 120_000,
  })
})

/** Upload an image to the workspace the way the browser does. */
async function uploadImage(page: Page, file: string) {
  const bytes = await readFile(file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const signed = await requestJson(page, '/api/tenant/assets/upload-url', {
    bytes: bytes.byteLength,
    classification: 'input',
    contentType: 'image/png',
    fileName: path.basename(file),
    sha256,
  })
  expect(signed.status).toBe(201)
  const body = signed.body as { asset: { id: string }; uploadUrl: string }
  expect(await uploadSignedAsset(page, body.uploadUrl, [...bytes], 'image/png')).toBe(200)
  expect(
    (await requestJson(page, `/api/tenant/assets/${body.asset.id}/complete`, { sha256 })).status
  ).toBe(200)
  return body.asset.id
}

test('I: release automation lays out a canvas from a release on the server', async ({
  app,
  identity,
  page,
}) => {
  const key = process.env.E2E_WORKFLOW_RENDER_KEY ?? ''
  test.skip(key.length < 32, 'Needs the workflow key dev/studio generates.')
  const organizationId = await setUp(identity, page)
  const captureAssetId = await uploadImage(page, 'public/demo/demo-1.png')
  const created = await trpcMutation(page, 'release.create', {
    title: 'Bulk approvals',
    benefitStatement: 'Approve ten launches at once.',
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  const releaseId = (created.body as { release: { id: string } }).release.id
  const url = getE2EUrl('/api/internal/workflow-canvases')
  // What the Go worker sends: the run's node, its release, a capture and the templates.
  const send = (payload: Record<string, unknown>, signed = true) => {
    const body = JSON.stringify(payload)
    const stamp = Math.floor(Date.now() / 1000)
    const signature = signed
      ? `t=${stamp},v1=${createHmac('sha256', key).update(`${stamp}.${body}`).digest('hex')}`
      : `t=${stamp},v1=${'0'.repeat(64)}`
    return page.request.post(url, {
      data: body,
      headers: { 'content-type': 'application/json', 'x-shots-signature': signature },
    })
  }
  const request = {
    organizationId,
    runId: `run-${identity.email.split('@')[0]}`,
    nodeId: 'board',
    releaseId,
    captureAssetId,
    recipeIds: ['feature-announcement', 'social-pack'],
  }
  expect((await send(request, false)).status()).toBe(401)
  expect((await send({ ...request, releaseId: 'not-a-release' })).status()).toBe(422)

  const made = await send(request)
  expect(made.status(), await made.text()).toBe(200)
  const { canvasId } = (await made.json()) as { canvasId: string }
  expect(canvasId).toMatch(/^c[a-z0-9]{24}$/)
  // A retried activity gets the same canvas back.
  const again = await send(request)
  expect(((await again.json()) as { canvasId: string }).canvasId).toBe(canvasId)

  const result = await trpcQuery(page, 'canvas.get', { canvasId })
  expect(result.status).toBe(200)
  const canvas = (result.body as { document: CanvasDocument }).document
  expect(canvas.context.releaseId).toBe(releaseId)
  expect(canvas.artboards.length).toBeGreaterThanOrEqual(2)
  const json = JSON.stringify(canvas)
  expect(json).toContain(`asset:${captureAssetId}`)
  expect(json).not.toMatch(/"data:|"blob:/)
  const words = canvas.artboards.flatMap((artboard) =>
    artboard.document.texts.map((text) => text.text)
  )
  expect(words).toContain('Bulk approvals')
  // The headline quotes the release record, so it arrives verified with its source.
  expect(
    canvas.artboards
      .flatMap((artboard) => artboard.provenance)
      .some((claim) => claim.status === 'verified' && claim.reference?.id === releaseId)
  ).toBe(true)

  await app.open(`/canvas/${canvasId}`)
  await expect(page.locator('[data-artboard-id]')).toHaveCount(canvas.artboards.length, {
    timeout: 120_000,
  })
  await expect(page.locator('[data-artboard-id] img').first()).toBeVisible({ timeout: 120_000 })
  await page.keyboard.press('Shift+Digit1')
  // eslint-disable-next-line no-restricted-syntax -- The zoom animation has no end event; the report screenshot waits it out.
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(out, 'i-automation-canvas.png') })
})

test('J: a canvas exports a PDF whose pages keep real text and vector shapes', async ({
  app,
  identity,
  page,
}) => {
  await setUp(identity, page)
  await app.open('/canvas/new?blank=1')
  await expect(page).toHaveURL(/\/canvas\/c[a-z0-9]{24}$/, { timeout: 180_000 })
  await saved(page)
  await page.getByRole('button', { name: '1:1 · 1080 × 1080' }).click()
  await saved(page)
  await openArtboard(page, '1:1')
  await page.getByRole('button', { name: 'Rounded rectangle', exact: true }).click()
  await page.keyboard.press('t')
  const stage = (await page.locator('#image-render-card').boundingBox())!
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.2)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Selectable launch copy')
  await page.keyboard.press('ControlOrMeta+Enter')
  await saved(page)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Export', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Export artboards' })
  await dialog.getByRole('checkbox', { name: /^All/ }).check()
  await chooseOption(dialog.getByLabel('Export format'), 'PDF · selectable text and vector shapes')
  await dialog.getByRole('button', { name: /^Render \d+/ }).click()
  const download = dialog.getByRole('button', { name: 'Download PDF' })
  const refused = dialog.getByRole('alert')
  await expect(download.and(page.locator(':enabled')).or(refused).first()).toBeVisible({
    timeout: 180_000,
  })
  if (process.env.E2E_DESIGN_RENDERER !== '1') {
    // The e2e stack runs without the server renderer: the export says so instead of failing silently.
    await expect(refused).toContainText('server renderer')
    return
  }
  expect(await refused.allTextContents()).toEqual([])
  const pending = page.waitForEvent('download')
  await download.click()
  const file = path.join(out, (await pending).suggestedFilename())
  await (await pending).saveAs(file)
  const pdf = (await readFile(file)).toString('latin1')
  expect(pdf.startsWith('%PDF-')).toBe(true)
  // One page per artboard, each at its own size (Chromium writes 0.75 pt per CSS pixel).
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((match) => [
    Math.round(Number(match[1]) / 0.75),
    Math.round(Number(match[2]) / 0.75),
  ])
  expect(boxes).toEqual(
    expect.arrayContaining([
      [1600, 900],
      [1080, 1080],
    ])
  )
  expect(boxes).toHaveLength(2)
  // Real text: fonts with a Unicode map, so the words can be selected and searched.
  expect(pdf).toMatch(/\/Subtype \/(Type3|TrueType|Type0)/)
  expect(pdf).toContain('/ToUnicode')
  // Not pictures of the pages: these artboards hold only text and shapes, so the file has no
  // colour image at all (greyscale images are the soft masks of shadows).
  const colourImages = [...pdf.matchAll(/<<([^>]*?\/Subtype \/Image[^>]*?)>>/g)].filter((match) =>
    /\/ColorSpace \/DeviceRGB|\/ColorSpace \/ICCBased|\/ColorSpace \[/.test(match[1]!)
  )
  expect(colourImages).toHaveLength(0)
})
