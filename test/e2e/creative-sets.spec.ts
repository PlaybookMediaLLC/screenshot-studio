import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import type { Page, Route } from '@playwright/test'
import { createScratchDocument, publicAsset } from '@/lib/store-screenshots/document/factory'
import type { CreativeSetDocument } from '@/lib/creative-sets/document'
import { getE2EUrl, signUpViaApi, getActiveOrganizationId } from './framework/auth'
import { configureE2EFlow, expect, test, type E2EIdentity } from './framework/flow'
import { trpcMutation, trpcQuery } from './framework/trpc'
import { createE2EDatabase, grantWorkspaceFeature, grantWorkspacePlan } from './framework/services'

configureE2EFlow()
test.setTimeout(600_000)
test.use({ actionTimeout: 30_000 })

async function signUpAndCreateWorkspace(identity: E2EIdentity, page: Page) {
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
  await grantWorkspaceFeature(organizationId, 'creative-sets:create')
  // Cold dev compilation refreshes shared CSS and can cancel a concurrent client navigation.
  await page.request.get(getE2EUrl('/creative-sets/c000000000000000000000000'), {
    timeout: 120_000,
  })
  await page.request.get(getE2EUrl('/render/local'), { timeout: 120_000 })
  return organizationId
}

async function saved(page: Page) {
  await expect(page.getByTestId('set-save-status')).toContainText('Saved', { timeout: 45_000 })
  await expect(page.getByRole('button', { exact: true, name: 'Export' })).toBeEnabled()
}
async function record(page: Page, creativeSetId: string) {
  const result = await trpcQuery(page, 'creativeSet.get', { creativeSetId })
  expect(result.status).toBe(200)
  return result.body as { id: string; document: CreativeSetDocument; revision: number }
}
async function create(page: Page) {
  await page.goto(getE2EUrl('/creative-sets'))
  await page.getByRole('button', { name: 'New Story Set' }).click()
  await page.getByLabel('Story Set name').fill('Approvals launch')
  await page.getByLabel('Story headline', { exact: true }).fill('Decide with confidence')
  await page
    .getByLabel('Product screenshot', { exact: true })
    .setInputFiles('public/demo/notion-showcase.webp')
  await page.getByRole('button', { name: 'Create three formats' }).click({ timeout: 45_000 })
  await expect(page).toHaveURL(/\/creative-sets\/c[a-z0-9]+$/, { timeout: 120_000 })
  await saved(page)
  return new URL(page.url()).pathname.split('/').at(-1)!
}

test('create, customize, replace evidence, reopen, restore and deliver three native formats', async ({
  identity,
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  await page.getByRole('button', { name: /^Square card/ }).click()
  await saved(page)
  await page.getByLabel('This format headline', { exact: true }).fill('Your next decision')
  await page.getByLabel('This format headline', { exact: true }).press('Tab')
  await saved(page)
  await expect(page.getByText('Override · this format only', { exact: true }).first()).toBeVisible()

  await page.getByLabel('Story headline', { exact: true }).fill('See what needs you')
  await page.getByLabel('Story headline', { exact: true }).press('Tab')
  await saved(page)
  let current = await record(page, id)
  const headlines = (document: CreativeSetDocument) =>
    document.outputs.map(
      (output) => output.document.texts.find((text) => text.id === output.bindings.headline)?.text
    )
  expect(headlines(current.document)).toEqual([
    'See what needs you',
    'Your next decision',
    'See what needs you',
  ])
  await page.getByRole('button', { exact: true, name: 'Undo' }).click()
  await saved(page)
  expect((await record(page, id)).document.stories[0]!.headline).toBe('Decide with confidence')
  await page.getByRole('button', { exact: true, name: 'Redo' }).click()
  await saved(page)

  await page.getByRole('button', { exact: true, name: 'History' }).click()
  await page.getByLabel('Version name').fill('Before product update')
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await expect(page.getByRole('button', { name: /Before product update · r/ })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  const before = await record(page, id)
  await page.getByRole('tab', { name: 'Product', exact: true }).click()
  await page.getByRole('button', { name: 'Replace story screenshot' }).click()
  await page.getByLabel('Replacement screenshot').setInputFiles('public/demo/demo-1.png')
  await page.getByLabel('Focus x percent').fill('65')
  await page.getByLabel('Focus width percent').fill('20')
  await page.getByRole('button', { name: 'Apply screenshot update' }).click({ timeout: 45_000 })
  await saved(page)
  current = await record(page, id)
  expect(current.document.stories[0]!.source.src).not.toBe(before.document.stories[0]!.source.src)
  expect(current.document.stories[0]!.source.revision).toBe(2)
  expect(headlines(current.document)).toEqual(headlines(before.document))
  expect(current.document.outputs.every((output) => output.review.source)).toBe(true)
  expect(current.document.outputs[1]!.document.image.offset).toEqual(
    before.document.outputs[1]!.document.image.offset
  )

  for (const name of ['Wide hero', 'Square card', 'Portrait card']) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await saved(page)
    await page.getByRole('button', { name: 'Mark format reviewed' }).click()
    await saved(page)
  }
  await page.reload()
  await saved(page)
  expect(headlines((await record(page, id)).document)).toEqual(headlines(current.document))
  await mkdir('.context', { recursive: true })
  await page.screenshot({ path: '.context/story-set-board.png', fullPage: true })

  await page.getByRole('button', { exact: true, name: 'Export' }).click()
  const dialog = page.getByRole('dialog', { name: 'Deliver Story Set' })
  await expect(dialog.getByRole('button', { name: 'Download ZIP' })).toBeEnabled({
    timeout: 90_000,
  })
  await expect(dialog.getByRole('button', { name: 'Download PNG', exact: true })).toHaveCount(3)
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download ZIP' }).click()
  const download = await downloadPromise
  const file = path.resolve('.context/story-set-export.zip')
  await download.saveAs(file)
  const zip = await JSZip.loadAsync(await readFile(file))
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  expect(manifest.setId).toBe(id)
  expect(manifest.outputs).toHaveLength(3)
  const dimensions = []
  for (const output of manifest.outputs) {
    expect(output.documentHash).toMatch(/^[0-9a-f]{64}$/)
    const metadata = await sharp(await zip.file(output.fileName)!.async('nodebuffer')).metadata()
    dimensions.push([metadata.width, metadata.height])
  }
  expect(dimensions).toEqual([
    [1600, 900],
    [1080, 1080],
    [1080, 1350],
  ])
  await dialog.getByRole('button', { name: 'Save to workspace assets' }).click()
  await expect(dialog.getByText(/3 new files saved/)).toBeVisible({ timeout: 60_000 })
  const delivered = (await record(page, id)).document.deliveries
  expect(delivered).toHaveLength(3)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  const createdCampaign = await trpcMutation(page, 'campaign.create', {
    name: 'Approvals release',
    objective: 'Explain approvals',
    posts: [],
  })
  expect(createdCampaign.status).toBe(200)
  const campaignId = (createdCampaign.body as { campaign: { id: string } }).campaign.id
  await page.getByRole('button', { name: 'Campaign…', exact: true }).click()
  const handoff = page.getByRole('dialog', { name: 'Attach delivered creative' })
  await handoff.getByLabel('Campaign').selectOption(campaignId)
  await handoff.getByLabel('Immutable delivered file').selectOption(delivered[0]!.id)
  await handoff.getByLabel('Draft post').fill('See your next decision in one place.')
  await handoff.getByRole('button', { name: 'Attach for campaign review' }).click()
  await expect(handoff.getByText(/delivered revision is attached/)).toBeVisible()
  await expect(
    handoff.getByRole('link', { name: 'Review and schedule publication' })
  ).toHaveAttribute('href', `/campaigns/${campaignId}`)
  await handoff.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('tab', { name: 'Message', exact: true }).click()
  await page.getByLabel('Story headline', { exact: true }).fill('A new revision')
  await page.getByLabel('Story headline', { exact: true }).press('Tab')
  await saved(page)
  expect((await record(page, id)).document.deliveries).toEqual(delivered)
  await page.getByRole('button', { exact: true, name: 'History' }).click()
  await page.getByRole('button', { name: /Before product update · r/ }).click()
  await page.getByRole('button', { name: 'Restore as a new revision' }).click()
  await saved(page)
  const restored = await record(page, id)
  expect(restored.revision).toBeGreaterThan(before.revision)
  expect(restored.document.stories[0]!.source.src).toBe(before.document.stories[0]!.source.src)
})

test('interrupted saves recover and a real second writer cannot be overwritten', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  const block = (route: Route) => route.abort('internetdisconnected')
  await page.route('**/api/trpc/**creativeSet.updateDocument**', block)
  await page.getByLabel('Story headline', { exact: true }).fill('Recovered locally')
  await page.getByLabel('Story headline', { exact: true }).press('Tab')
  await expect(page.getByTestId('set-save-status')).toContainText('Offline', { timeout: 30_000 })
  await page.reload()
  await page.unroute('**/api/trpc/**creativeSet.updateDocument**', block)
  await page.getByRole('button', { name: 'Recover draft', exact: true }).click()
  await saved(page)
  expect((await record(page, id)).document.stories[0]!.headline).toBe('Recovered locally')
  const prior = await record(page, id)
  const other = structuredClone(prior.document)
  other.stories[0]!.headline = 'Another writer'
  for (const output of other.outputs)
    output.document.texts.find((text) => text.id === output.bindings.headline)!.text =
      'Another writer'
  expect(
    (
      await trpcMutation(page, 'creativeSet.updateDocument', {
        creativeSetId: id,
        baseRevision: prior.revision,
        document: other,
      })
    ).status
  ).toBe(200)
  await page.getByLabel('Story headline', { exact: true }).fill('Keep my work')
  await page.getByLabel('Story headline', { exact: true }).press('Tab')
  await expect(
    page.getByText('This set changed elsewhere. Your local work is preserved.')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Keep mine as a copy' }).click()
  await expect(page).not.toHaveURL(getE2EUrl(`/creative-sets/${id}`))
  await saved(page)
  expect((await record(page, id)).document.stories[0]!.headline).toBe('Another writer')
})

test('another principal cannot read sets, versions or sources; viewer writes are denied', async ({
  browser,
  identity,
  page,
}) => {
  const organizationId = await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  const own = await record(page, id)
  const versions = (await trpcQuery(page, 'creativeSet.versions', { creativeSetId: id })).body as {
    id: string
  }[]
  const context = await browser.newContext()
  try {
    const stranger = await context.newPage()
    await signUpAndCreateWorkspace(
      {
        ...identity,
        email: `other-${identity.email}`,
        workspaceName: `Other ${identity.workspaceName}`,
      },
      stranger
    )
    for (const [procedure, input] of [
      ['creativeSet.get', { creativeSetId: id }],
      ['creativeSet.versions', { creativeSetId: id }],
      ['creativeSet.version', { creativeSetId: id, versionId: versions[0]!.id }],
      ['asset.signDownload', { assetId: own.document.stories[0]!.source.src.slice(6) }],
    ] as const)
      expect((await trpcQuery(stranger, procedure, input)).status).toBe(404)
    for (const [procedure, input] of [
      ['creativeSet.rename', { creativeSetId: id, name: 'Stolen' }],
      ['creativeSet.archive', { creativeSetId: id }],
      ['creativeSet.duplicate', { creativeSetId: id }],
      [
        'creativeSet.restoreVersion',
        { creativeSetId: id, versionId: versions[0]!.id, baseRevision: 1 },
      ],
    ] as const)
      expect((await trpcMutation(stranger, procedure, input)).status).toBe(404)
    const rejected = await trpcMutation(stranger, 'creativeSet.create', {
      id: `c${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
      name: 'Foreign evidence',
      document: own.document,
    })
    expect(rejected.status).toBe(400)
    expect(
      ((await trpcQuery(stranger, 'creativeSet.list', {})).body as { items: unknown[] }).items
    ).toHaveLength(0)
  } finally {
    await context.close()
  }
  const database = createE2EDatabase()
  try {
    await database.query('UPDATE member SET role = $1 WHERE "organizationId" = $2', [
      'viewer',
      organizationId,
    ])
  } finally {
    await database.end()
  }
  expect(
    (
      await trpcMutation(page, 'creativeSet.updateDocument', {
        creativeSetId: id,
        baseRevision: own.revision,
        document: own.document,
      })
    ).status
  ).toBe(403)
})

test('multiple stories, reusable versions and proposals remain editable through motion delivery', async ({
  identity,
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  await page.getByRole('button', { name: 'Add story', exact: true }).click()
  const intake = page.getByRole('dialog', { name: 'Add a product story' })
  await intake.getByLabel('Story headline', { exact: true }).fill('Resolve requests together')
  await intake
    .getByLabel('Product screenshot', { exact: true })
    .setInputFiles('public/demo/demo-1.png')
  await intake.getByRole('button', { name: 'Create three formats' }).click()
  await saved(page)
  expect((await record(page, id)).document.stories).toHaveLength(2)
  expect((await record(page, id)).document.outputs).toHaveLength(6)

  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Reusable treatments…', exact: true }).click()
  let reuse = page.getByRole('dialog', { name: 'Reusable visual treatments' })
  await reuse.getByLabel('Published name').fill('Feature proof')
  await reuse.getByRole('button', { name: 'Publish version', exact: true }).click()
  await reuse.getByRole('button', { name: 'Keep', exact: true }).click()
  await saved(page)
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Reusable treatments…', exact: true }).click()
  reuse = page.getByRole('dialog', { name: 'Reusable visual treatments' })
  await expect(reuse.getByText(/Feature proof · v1/)).toBeVisible()
  await reuse.getByLabel('Published name').fill('Feature proof')
  await reuse.getByRole('button', { name: 'Publish version', exact: true }).click()
  await reuse.getByRole('button', { name: 'Keep', exact: true }).click()
  await saved(page)
  expect(
    (await record(page, id)).document.outputs.some((output) =>
      output.reusable.some((ref) => ref.version === 2)
    )
  ).toBe(true)

  // The browser checks proposal scope and acceptance; the provider boundary is deterministic here.
  await page.route('**/api/trpc/**creativeSet.proposeCopy**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          result: {
            data: {
              json: {
                proposals: [
                  {
                    headline: 'Resolve together',
                    supporting: '',
                    reason: 'Shorter wording from supplied facts.',
                  },
                ],
              },
            },
          },
        },
      ]),
    })
  )
  await page.getByRole('tab', { name: 'Message', exact: true }).click()
  await page.getByRole('button', { name: 'Propose shorter copy…', exact: true }).click()
  const proposals = page.getByRole('dialog', { name: 'Propose shorter copy' })
  await proposals.getByRole('button', { name: 'Request proposals' }).click()
  await proposals.getByRole('button', { name: /Resolve together/ }).click()
  await proposals.getByRole('button', { name: 'Keep', exact: true }).click()
  await saved(page)
  expect(
    (await record(page, id)).document.outputs.some(
      (output) =>
        output.overrides.headline &&
        output.document.texts.some((layer) => layer.text === 'Resolve together')
    )
  ).toBe(true)
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByLabel('Motion · this format').selectOption('proof-reveal')
  await saved(page)
  expect(
    (await record(page, id)).document.outputs.some(
      (output) => output.document.timeline?.layerTracks?.length
    )
  ).toBe(true)

  await page.getByRole('button', { name: 'Deliver motion…', exact: true }).click()
  const motion = page.getByRole('dialog', { name: 'Deliver motion' })
  await motion.getByRole('button', { name: 'Render video' }).click()
  await expect(motion.getByLabel('Motion rendering progress')).toBeVisible()
  await motion.getByRole('button', { name: 'Cancel render' }).click()
  await expect(motion.getByRole('button', { name: 'Render video' })).toBeEnabled()
  await motion.getByRole('button', { name: 'Render video' }).click()
  await expect(motion.getByRole('button', { name: 'Download video ZIP' })).toBeEnabled({
    timeout: 150_000,
  })
  await expect
    .poll(() =>
      motion
        .locator('video')
        .evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight])
    )
    .toEqual([1600, 900])
  const downloadMotion = page.waitForEvent('download')
  await motion.getByRole('button', { name: 'Download video ZIP' }).click()
  await (await downloadMotion).saveAs('.context/story-motion.zip')
  await motion.getByRole('button', { name: 'Save to workspace assets' }).click()
  await expect(motion.getByRole('button', { name: 'Saved to assets' })).toBeVisible({
    timeout: 45_000,
  })
  await motion.getByRole('button', { name: 'Close', exact: true }).click()
})

test('store migration preserves originals and delivers native edits and motion', async ({
  identity,
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  const native = createScratchDocument()
  native.name = 'Local original'
  native.revision = 7
  const secondAsset = publicAsset('/store-screenshot-learn.png', 'Second-screen.png')
  native.assets[secondAsset.id] = secondAsset
  await page.evaluate(async (document) => {
    const request = indexedDB.open('shots-store-studio', 1)
    request.onupgradeneeded = () => {
      for (const name of ['projects', 'assets', 'versions', 'brandKits', 'templates', 'meta'])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, name === 'meta' ? undefined : { keyPath: 'id' })
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['projects'], 'readwrite')
      transaction.objectStore('projects').put({
        id: document.id,
        name: document.name,
        updatedAt: document.updatedAt,
        slideCount: document.slides.length,
        thumbnail: null,
        document,
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, native)
  let firstUploads = 0,
    interrupted = false
  const interruptUpload = async (route: Route) => {
    const body = route.request().postData() ?? ''
    if (body.includes('Screenshot-1')) firstUploads++
    if (body.includes('Second-screen.png') && !interrupted) {
      interrupted = true
      await route.abort('internetdisconnected')
    } else await route.continue()
  }
  await page.route('**/api/trpc/**asset.signUpload**', interruptUpload)
  await page.getByRole('button', { name: 'Add store outputs', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Add store outputs' })
    .getByRole('button', { name: 'Local original · 1 slides' })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Add store outputs' }).getByRole('alert')
  ).toBeVisible()
  expect(interrupted).toBe(true)
  await page
    .getByRole('dialog', { name: 'Add store outputs' })
    .getByRole('button', { name: 'Local original · 1 slides' })
    .click()
  await saved(page)
  expect(firstUploads).toBe(1)
  await page.unroute('**/api/trpc/**asset.signUpload**', interruptUpload)
  const copied = (await record(page, id)).document.storeGroups[0]!
  expect(copied.origin?.id).toBe(native.id)
  expect(copied.origin?.revision).toBe(7)
  expect(copied.document.slides).toEqual(native.slides)
  expect(Object.values(copied.assetMap).every((value) => value.startsWith('asset:'))).toBe(true)
  await page.reload()
  await saved(page)
  await page
    .getByRole('region', { name: 'Store output groups' })
    .getByRole('button', { name: /Local original/ })
    .click()
  await expect(page.getByLabel('Story for selected store slide')).toBeVisible()
  const canvas = page.locator('[data-store-canvas-slide]')
  await expect(canvas).toBeVisible()
  await expect
    .poll(() =>
      canvas
        .locator('img[src^="blob:"]')
        .evaluateAll((images) =>
          images.some(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
          )
        )
    )
    .toBe(true)
  await page
    .getByLabel('Story for selected store slide')
    .selectOption((await record(page, id)).document.stories[0]!.id)
  await page.getByRole('button', { name: 'Link slide to story' }).click()
  await saved(page)
  const heading = canvas.getByText('Decide with confidence', { exact: true })
  await expect(heading).toBeVisible()
  const box = (await heading.boundingBox())!
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('[data-store-inline-editor]')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Store only')
  await page.keyboard.press('Escape')
  await saved(page)
  await expect(canvas).toContainText('Store only')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page)
  await expect(canvas).not.toContainText('Store only')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await saved(page)
  await expect(canvas).toContainText('Store only')
  await page.getByRole('button', { name: 'Mark store group reviewed' }).click()
  await saved(page)
  await page.screenshot({ path: '.context/story-set-store.png', fullPage: true })
  await page.getByRole('button', { name: 'Export store sizes' }).click()
  await page
    .getByRole('dialog', { name: 'Export screenshots' })
    .getByRole('button', { name: /^Export \d+ files?$/ })
    .click()
  const storeDelivery = page.getByRole('dialog', { name: 'Deliver store outputs' })
  await expect(storeDelivery).toBeVisible({ timeout: 120_000 })
  const downloadStore = page.waitForEvent('download')
  await storeDelivery.getByRole('button', { name: 'Download ZIP' }).click()
  await (await downloadStore).saveAs('.context/story-store-export.zip')
  const storeZip = await JSZip.loadAsync(await readFile('.context/story-store-export.zip'))
  const storeManifest = JSON.parse(await storeZip.file('manifest.json')!.async('string'))
  for (const file of storeManifest.outputs) {
    const metadata = await sharp(await storeZip.file(file.fileName)!.async('nodebuffer')).metadata()
    expect([metadata.width, metadata.height]).toEqual([file.store.width, file.store.height])
    expect(file.outputId).toBe(copied.id)
  }
  await storeDelivery.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Motion', exact: true }).click()
  const animation = page.getByRole('dialog', { name: 'Animated preview' })
  await animation.getByRole('button', { name: /^Export MP4/ }).click()
  const storeMotion = page.getByRole('dialog', { name: 'Deliver store motion' })
  await expect(storeMotion).toBeVisible({ timeout: 120_000 })
  const downloadStoreMotion = page.waitForEvent('download')
  await storeMotion.getByRole('button', { name: 'Download video ZIP' }).click()
  await (await downloadStoreMotion).saveAs('.context/story-store-motion.zip')
})

test('two workspace members see presence and safely merge independent edits', async ({
  identity,
  page,
  browser,
}) => {
  const organizationId = await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  const context = await browser.newContext()
  try {
    const peer = await context.newPage()
    const email = `peer-${identity.email}`
    await signUpViaApi({ ...identity, email, name: 'Story colleague' }, peer)
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
    await peer.goto(getE2EUrl(`/creative-sets/${id}`))
    await saved(peer)
    await expect(page.getByText('Story colleague here', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const local = page.getByLabel('Story headline', { exact: true })
    await local.fill('A shared decision')
    const detail = peer.getByLabel('Story supporting line', { exact: true })
    await detail.fill('Independent peer detail')
    await local.press('Tab')
    await detail.press('Tab')
    await saved(page)
    await saved(peer)
    await expect
      .poll(async () => (await record(page, id)).document.stories[0]!.supporting)
      .toBe('Independent peer detail')
    await expect
      .poll(async () => (await record(page, id)).document.stories[0]!.headline)
      .toBe('A shared decision')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await saved(page)
    expect((await record(page, id)).document.stories[0]!.supporting).toBe('Independent peer detail')
  } finally {
    await context.close()
  }
})

test('copying a legacy cloud project preserves the native original and its origin', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  const native = structuredClone((await record(page, id)).document.outputs[0]!.document)
  native.image.offset = { x: 0.123456, y: -0.025 }
  native.texts[0]!.visible = false
  const created = await trpcMutation(page, 'project.create', {
    name: 'Original launch',
    document: native,
  })
  expect(created.status).toBe(200)
  const project = created.body as { id: string; revision: number; document: typeof native }
  await page.getByRole('button', { name: 'Story actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Copy project', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Copy an existing project' })
    .getByRole('button', { name: 'Original launch', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Copy an existing project' })).not.toBeVisible()
  await saved(page)
  const copied = (await record(page, id)).document.outputs.find(
    (output) => output.origin?.id === project.id
  )!
  expect(copied.format).toBe('original')
  expect(copied.origin).toMatchObject({
    kind: 'project',
    id: project.id,
    revision: project.revision,
  })
  expect(copied.document).toEqual(project.document)
  const untouched = (await trpcQuery(page, 'project.get', { projectId: project.id }))
    .body as typeof project
  expect(untouched.document).toEqual(project.document)
  expect(untouched.revision).toBe(project.revision)
})

test('resizing the workspace preserves native geometry, copy and undo history', async ({
  identity,
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1100 })
  await signUpAndCreateWorkspace(identity, page)
  const id = await create(page)
  await page.getByLabel('This format headline', { exact: true }).fill('My custom headline')
  await page.getByLabel('This format headline', { exact: true }).press('Tab')
  await saved(page)
  const before = await record(page, id)
  const layer = page.locator(
    `[data-text-overlay-id="${before.document.outputs[0]!.bindings.headline}"]`
  )
  // The stage scales with a transform, so measure what is drawn, not CSS sizes.
  const drawn = () =>
    layer.evaluate((element) => ({
      text: element.getBoundingClientRect().height,
      canvas: element.closest('[data-html-canvas]')!.getBoundingClientRect().width,
    }))
  const original = await drawn()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(async () => (await drawn()).text).toBeLessThan(original.text)
  await expect.poll(async () => (await drawn()).canvas).toBeLessThan(original.canvas)
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await saved(page)
  expect((await record(page, id)).document).toEqual(before.document)
  await page.setViewportSize({ width: 1680, height: 1100 })
  await expect.poll(async () => (await drawn()).text).toBeCloseTo(original.text, 0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved(page)
  expect((await record(page, id)).document.outputs[0]!.document.texts[0]!.text).toBe(
    'Decide with confidence'
  )
})
