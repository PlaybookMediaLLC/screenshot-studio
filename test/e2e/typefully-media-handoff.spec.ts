import sharp from 'sharp'
import { expect } from '@playwright/test'
import { configureE2EFlow, test } from './framework/flow'
import {
  createDraftWorkspace,
  draftEditor,
  expectSaved,
  type DraftWorkspace,
} from './framework/content-drafts'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { importedBody } from '@/lib/write/import-text'

configureE2EFlow()
test.use({ actionTimeout: 30_000 })

test('a framed workspace export returns to its draft for explicit attachment', async ({
  page,
  identity,
}) => {
  test.setTimeout(240_000)
  let workspace: DraftWorkspace | null = null
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    workspace = await createDraftWorkspace(identity, page)
    await page.goto('/write')
    await page.getByRole('button', { name: 'Bulk import', exact: true }).click()
    const png = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#e5eef8' },
    })
      .png()
      .toBuffer()
    await page
      .getByLabel('Batch media files')
      .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: png })
    await page
      .getByLabel('Batch CSV', { exact: true })
      .fill('caption,asset,channels\nFrame handoff,source.png,x')
    await page.getByRole('button', { name: 'Review import', exact: true }).click()
    await page.getByRole('button', { name: 'Create remaining drafts', exact: true }).click()
    const created = page.getByRole('link', { name: 'Draft created', exact: true })
    await expect(created).toBeVisible({ timeout: 60_000 })
    const url = (await created.getAttribute('href'))!
    const id = url.split('/').at(-1)!
    const before = (await apiRequest(page, `/api/v1/content-drafts/${id}`)).body as {
      assetIds: string[]
    }
    await page.goto(url)
    await page.getByRole('button', { name: 'More draft actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Manage media…', exact: true }).click()
    const opened = page.context().waitForEvent('page')
    await page.getByRole('link', { name: 'Frame in Shots editor', exact: true }).click()
    const editor = await opened
    editor.setDefaultTimeout(30_000)
    editor.on('pageerror', (error) => errors.push(error.message))
    await editor.waitForLoadState('domcontentloaded')
    // Loading the source resets the canvas controls; wait for that handoff to finish.
    await expect
      .poll(() => new URL(editor.url()).searchParams.get('asset'), { timeout: 60_000 })
      .toBeNull()
    await editor.getByRole('button', { name: 'Frame', exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Frame', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await editor.getByRole('button', { name: 'Browser frame', exact: true }).click()
    await editor.getByRole('button', { name: 'Apply browser frame', exact: true }).click()
    await editor.getByRole('button', { name: 'Export', exact: true }).click()
    await editor.getByRole('button', { name: 'PNG', exact: true }).click()
    await editor.getByRole('button', { name: 'Save to workspace', exact: true }).click()
    const review = editor.getByRole('link', { name: 'Review export in draft', exact: true })
    await expect(review).toBeVisible({ timeout: 90_000 })
    const destination = (await review.getAttribute('href'))!
    const assetId = new URL(destination, 'http://localhost').searchParams.get('attach')!
    expect(assetId).not.toBe(before.assetIds[0])
    // Exporting has not altered the draft or replaced its original upload.
    expect(
      ((await apiRequest(page, `/api/v1/content-drafts/${id}`)).body as { assetIds: string[] })
        .assetIds
    ).toEqual(before.assetIds)
    await review.click()
    await expect(editor.getByAltText('Framed export', { exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'Attach framed export', exact: true }).click()
    await expect(editor.getByTestId('draft-media-item')).toHaveCount(2)
    await editor.keyboard.press('Escape')
    await expectSaved(editor)
    await editor.reload()
    const after = (await apiRequest(editor, `/api/v1/content-drafts/${id}`)).body as {
      assetIds: string[]
    }
    expect(after.assetIds).toEqual(expect.arrayContaining([...before.assetIds, assetId]))
    const bytes = await editor.request.get(`/api/v1/assets/${assetId}/content`)
    expect(bytes.status()).toBe(200)
    const metadata = await sharp(await bytes.body()).metadata()
    expect(metadata.width).toBeGreaterThan(640)
    await editor.screenshot({ path: '.context/shots/typefully-frame-handoff.png' })
    expect(errors).toEqual([])
    await editor.close()
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('dragging a thread post preserves its contents and ordering after refresh', async ({
  page,
  identity,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page)
    const created = await apiRequest(page, '/api/v1/content-drafts', {
      method: 'POST',
      body: {
        title: 'Thread order',
        plainText: 'First\nSecond\nThird',
        body: importedBody(['First', 'Second', 'Third']),
        channelConnectionIds: [workspace.channels.x],
      },
    })
    expect(created.status).toBe(201)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/write/${(created.body as { id: string }).id}`)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const resize = page.getByRole('separator', { name: 'Resize preview sidebar' })
    const initialWidth = Number(await resize.getAttribute('aria-valuenow'))
    await resize.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(resize).toHaveAttribute('aria-valuenow', String(initialWidth + 64))
    const handle = await resize.boundingBox()
    expect(handle).not.toBeNull()
    await page.mouse.move(handle!.x + 2, handle!.y + 80)
    await page.mouse.down()
    await page.mouse.move(handle!.x - 78, handle!.y + 80, { steps: 5 })
    await page.mouse.up()
    await expect(resize).toHaveAttribute('aria-valuenow', String(initialWidth + 144))
    await page
      .getByRole('img', { name: 'Drag post 1', exact: true })
      .dragTo(page.locator('[data-post-number="3"]'))
    await expect(draftEditor(page)).toContainText(/Second[\s\S]*Third[\s\S]*First/)
    await expectSaved(page)
    await page.reload()
    await expect(draftEditor(page)).toContainText(/Second[\s\S]*Third[\s\S]*First/)
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})
