import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { expect, type Page } from '@playwright/test'
import { configureE2EFlow, test } from './framework/flow'
import {
  createDraftWorkspace,
  draftEditor,
  expectSaved,
  openNewDraft,
  type DraftWorkspace,
} from './framework/content-drafts'
import { chooseOption } from './framework/controls'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { importedBody } from '@/lib/write/import-text'

configureE2EFlow()
const fixture = (name: string) => `test/fixtures/typefully-media/${name}`
async function openMedia(page: Page) {
  await page.getByRole('button', { name: 'More draft actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Manage media…', exact: true }).click()
}

test('phone previews fit the sidebar, weighted long text expands, and link cards dismiss without removing the URL', async ({
  page,
  identity,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    workspace = await createDraftWorkspace(identity, page)
    const url = `https://example.com/${'path'.repeat(100)}`
    const text = 'a'.repeat(250) + ' ' + url
    await page.route('**/api/v1/content-drafts/link-card?*', (route) =>
      route.fulfill({
        json: {
          url,
          title: 'Linked resource',
          description: 'Fetched metadata',
          image: null,
          siteName: 'Example',
        },
      })
    )
    const id = await openNewDraft(page)
    await draftEditor(page).fill(text)
    await expectSaved(page)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByTestId('preview-x')
    await expect(preview.getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0)
    await expect(preview.getByTestId('post-link-preview')).toContainText('Linked resource')
    await preview.getByTestId('post-link-preview').hover()
    await preview.getByRole('button', { name: 'Hide link preview', exact: true }).click()
    await expect(preview.getByTestId('post-link-preview')).toHaveCount(0)
    await expect(preview).toContainText('The platform may still show a link card')
    await expect(draftEditor(page)).toContainText(url)
    await preview.getByRole('button', { name: 'Show link preview', exact: true }).click()
    await expect(preview.getByTestId('post-link-preview')).toBeVisible()
    await draftEditor(page).fill(text + ' 👩🏽‍💻'.repeat(10) + ' ending')
    await expectSaved(page)
    await expect(preview.getByRole('button', { name: 'Show more', exact: true })).toBeVisible()
    await expect(preview).not.toContainText('ending')
    await preview.getByRole('button', { name: 'Show more', exact: true }).click()
    await expect(preview).toContainText('ending')
    await chooseOption(page.getByLabel('Preview device'), /^iPhone 17 Pro Max/)
    await expect(preview).toHaveAttribute('data-device-width', '440')
    await expect
      .poll(async () => {
        const box = await preview.boundingBox(),
          parent = await page.getByTestId('preview-viewport').boundingBox()
        return !!box && !!parent && box.width <= parent.width + 1 && box.x >= parent.x - 1
      })
      .toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(async () => {
        const box = await preview.boundingBox()
        return !!box && box.x >= -1 && box.x + box.width <= 391
      })
      .toBe(true)
    await page.reload()
    await expect(draftEditor(page)).toContainText('ending')
    const saved = (await apiRequest(page, `/api/v1/content-drafts/${id}`)).body as {
      plainText: string
    }
    expect(saved.plainText).toContain(url)
    expect(errors).toEqual([])
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('uploaded video plays in preview and imported PDFs render both carousel pages after reload', async ({
  page,
  identity,
}) => {
  test.setTimeout(180_000)
  let workspace: DraftWorkspace | null = null
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    workspace = await createDraftWorkspace(identity, page)
    await page.goto('/write')
    await page.getByRole('button', { name: 'Bulk import', exact: true }).click()
    await page
      .getByLabel('Batch media files')
      .setInputFiles([fixture('preview.mp4'), fixture('preview.pdf')])
    await page
      .getByLabel('Batch CSV', { exact: true })
      .fill(
        'caption,asset,channels\nMoving picture,preview.mp4,x\nTwo-page document,preview.pdf,linkedin'
      )
    await page.getByRole('button', { name: 'Review import', exact: true }).click()
    await page.getByRole('button', { name: 'Create remaining drafts', exact: true }).click()
    const links = page.getByRole('link', { name: 'Draft created', exact: true })
    await expect(links).toHaveCount(2, { timeout: 60_000 })
    const videoURL = (await links.nth(0).getAttribute('href'))!,
      pdfURL = (await links.nth(1).getAttribute('href'))!
    await page.goto(videoURL)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const video = page.getByTestId('preview-x').getByLabel('Video attachment')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
      .toBeGreaterThan(0)
    expect(await video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(64)
    await video.evaluate((el: HTMLVideoElement) => el.play())
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeGreaterThan(0)
    await page.reload()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(video).toBeVisible()
    await page.goto(pdfURL)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const carousel = page.getByTestId('pdf-carousel')
    await expect(carousel.getByTestId('pdf-page-count')).toHaveText('2 pages', { timeout: 45_000 })
    await expect
      .poll(() =>
        carousel
          .locator('canvas')
          .evaluate(
            (el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(20, 20, 1, 1).data[2]
          )
      )
      .toBe(255)
    await carousel.getByRole('button', { name: 'Next →', exact: true }).click()
    await expect(carousel.getByRole('img', { name: 'Page 2', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        carousel
          .locator('canvas')
          .evaluate(
            (el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(20, 20, 1, 1).data[0]
          )
      )
      .toBe(255)
    await page.reload()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(carousel.getByTestId('pdf-page-count')).toHaveText('2 pages')
    expect(errors).toEqual([])
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('link images and searched GIFs become real workspace assets; article covers preview their stored bytes', async ({
  page,
  identity,
}) => {
  test.setTimeout(180_000)
  test.skip(
    !process.env.NEXT_PUBLIC_PLATFORM_GIPHY_API_KEY,
    'Requires a configured fixture or production GIPHY key.'
  )
  let workspace: DraftWorkspace | null = null
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const image = await sharp({
      create: { width: 1200, height: 630, channels: 3, background: '#6611bb' },
    })
      .jpeg()
      .toBuffer()
    const gif = await readFile(fixture('preview.gif'))
    await page.route('**/api/v1/content-drafts/link-card?*', (route) =>
      route.fulfill({
        json: {
          url: 'https://example.com/article',
          title: 'Article image',
          description: null,
          image: 'https://example.com/cover.jpg',
          siteName: 'Example',
        },
      })
    )
    await page.route('**/api/link-preview/image?*', (route) =>
      route.fulfill({ contentType: 'image/jpeg', body: image })
    )
    await page.route('https://api.giphy.com/v1/gifs/search?*', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 'fixture',
              title: 'Moving colors',
              images: { fixed_height: { url: 'https://media.giphy.com/media/fixture/giphy.gif' } },
            },
          ],
        },
      })
    )
    await page.route('https://media.giphy.com/media/fixture/giphy.gif', (route) =>
      route.fulfill({ contentType: 'image/gif', body: gif })
    )
    const id = await openNewDraft(page)
    await draftEditor(page).fill('Media sources')
    await expectSaved(page)
    await openMedia(page)
    await page.getByLabel('Page URL for image').fill('https://example.com/article')
    await page.getByRole('button', { name: 'Find page image', exact: true }).click()
    await page.getByRole('button', { name: 'Attach 1200 × 630 image', exact: true }).click()
    await expect(page.getByTestId('draft-media-item')).toHaveCount(1)
    await page.getByLabel('Search GIFs').fill('colors')
    await page.getByRole('button', { name: 'Search GIPHY', exact: true }).click()
    await page.getByRole('button', { name: 'Attach Moving colors', exact: true }).click()
    await expect(page.getByTestId('draft-media-item')).toHaveCount(2)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expectSaved(page)
    await page.reload()
    const draft = (await apiRequest(page, `/api/v1/content-drafts/${id}`)).body as {
      assetIds: string[]
    }
    expect(draft.assetIds).toHaveLength(2)
    const metadata = []
    for (const asset of draft.assetIds) {
      const result = await page.request.get(`/api/v1/assets/${asset}/content`)
      expect(result.status()).toBe(200)
      metadata.push(await sharp(await result.body(), { animated: true }).metadata())
    }
    expect(metadata[0].width).toBe(1200)
    expect(metadata[1].format).toBe('gif')
    expect(metadata[1].pages).toBe(2)
    const created = await apiRequest(page, '/api/v1/content-drafts', {
      method: 'POST',
      body: {
        kind: 'article',
        article: { title: 'An article worth reading', coverAssetId: draft.assetIds[0] },
        body: importedBody(['Article content']),
        plainText: 'Article content',
        assetIds: [draft.assetIds[0]],
        channelConnectionIds: [workspace.channels.x],
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    await page.goto(`/write/${(created.body as { id: string }).id}`)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByTestId('preview-x')
    await expect(
      preview.getByRole('heading', { name: 'An article worth reading', exact: true })
    ).toBeVisible()
    await expect
      .poll(() => preview.locator('header img').evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(1200)
    expect(errors).toEqual([])
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})
