import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { z } from 'zod'
import { signUpAndCreateWorkspace } from './framework/auth'
import { requestJson, uploadSignedAsset } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'

const uploadSchema = z.object({
  asset: z.object({ id: z.string() }),
  uploadUrl: z.string(),
})

async function saveAsset(page: Page, png: Buffer): Promise<string> {
  const signed = uploadSchema.parse(
    (
      await requestJson(page, '/api/tenant/assets/upload-url', {
        bytes: png.length,
        classification: 'input',
        contentType: 'image/png',
        fileName: 'gallery-regression.png',
      })
    ).body
  )
  expect(await uploadSignedAsset(page, signed.uploadUrl, [...png], 'image/png')).toBe(200)
  expect(
    (await requestJson(page, `/api/tenant/assets/${signed.asset.id}/complete`, {})).status
  ).toBe(200)
  return signed.asset.id
}

configureE2EFlow()

test('assets stay current across pagination, deletion, filters, and browser Back', async ({
  identity,
  page,
}) => {
  test.slow()
  await signUpAndCreateWorkspace(identity, page)
  const png = await sharp({
    create: { width: 900, height: 1600, channels: 4, background: '#44aacc' },
  })
    .png()
    .toBuffer()
  const ids: string[] = []
  for (let index = 0; index < 25; index++) ids.push(await saveAsset(page, png))

  const listResponse = page.waitForResponse(
    (response) => response.url().includes('/api/trpc/') && response.url().includes('asset.list')
  )
  await page.goto('/assets')
  expect((await listResponse).headers()['cache-control']).toContain('no-store')
  const actions = page.getByRole('button', { name: /^Actions for PNG image/ })
  await expect(actions).toHaveCount(24)
  await expect(page.getByText('900×1600', { exact: false }).first()).toBeVisible()
  const image = page.getByRole('img', { name: 'PNG image preview' }).first()
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalHeight))
    .toBe(640)
  const boxes = await image.evaluate((element) => ({
    image: element.getBoundingClientRect().height,
    frame: element.parentElement!.getBoundingClientRect().height,
  }))
  expect(boxes.image).toBeLessThanOrEqual(boxes.frame)

  // Remove the last row on page one through another writer, then page past its cursor.
  const boundary = ids[1]
  expect((await requestJson(page, `/api/tenant/assets/${boundary}`, {}, 'DELETE')).status).toBe(202)
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(actions).toHaveCount(25)
  await expect(page.getByRole('button', { name: 'Load more' })).toBeHidden()

  // A stale card's second delete is NOT_FOUND, which still removes it locally.
  const ghost = page.getByRole('button', { name: `Actions for PNG image ${boundary.slice(0, 8)}` })
  await ghost.click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(ghost).toBeHidden()
  await expect(actions).toHaveCount(24)

  await page.getByRole('button', { name: 'Videos', exact: true }).click()
  await expect(page.getByText('No videos saved yet', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more' })).toBeHidden()
  await page.getByRole('button', { name: 'Images', exact: true }).click()
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Oldest first' }).click()
  await expect(actions.first()).toHaveAccessibleName(`Actions for PNG image ${ids[0].slice(0, 8)}`)
  await expect(page).toHaveURL(/type=image&sort=oldest/)

  // A new save while away from the gallery appears on Back, with the view preserved.
  await page.getByRole('link', { name: 'Open editor', exact: true }).click()
  const added = await saveAsset(page, png)
  await page.goBack()
  await expect(page).toHaveURL(/type=image&sort=oldest/)
  await expect(page.getByRole('button', { name: 'Images', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByRole('combobox')).toContainText('Oldest first')
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(
    page.getByRole('button', { name: `Actions for PNG image ${added.slice(0, 8)}` })
  ).toBeVisible()

  // A deleted item also stays gone after returning from the editor.
  const removed = page.getByRole('button', { name: `Actions for PNG image ${ids[0].slice(0, 8)}` })
  await removed.click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(removed).toBeHidden()
  await page.getByRole('link', { name: 'Open editor', exact: true }).click()
  await page.goBack()
  await expect(actions).toHaveCount(24)
  await expect(removed).toBeHidden()
})
