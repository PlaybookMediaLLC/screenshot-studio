import { randomUUID } from 'node:crypto'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { z } from 'zod'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getMaintenanceHeaders } from './framework/maintenance'
import {
  createE2EDatabaseClient,
  createE2EObjectStoreClient,
  getE2EObjectStoreBucket,
} from './framework/services'

const screenshotSchema = z.object({
  cached: z.boolean(),
  screenshot: z.string().min(1),
  url: z.string().url(),
})

configureE2EFlow()

async function getCacheRecord(url: string) {
  const database = createE2EDatabaseClient()
  try {
    return await database.screenshotCache.findFirst({ where: { url } })
  } finally {
    await database.$disconnect()
  }
}

test('a capture is cached and a maintenance invalidation forces a fresh capture', async ({
  app,
  page,
}) => {
  await app.open('/sign-in')
  const url = `https://cache-e2e.example/${randomUUID()}`
  const payload = { colorScheme: 'light', deviceType: 'desktop', url }
  const first = screenshotSchema.parse((await requestJson(page, '/api/screenshot', payload)).body)
  const cacheRecord = await getCacheRecord(`${first.url}:desktop:light`)
  if (!cacheRecord) {
    throw new Error('The screenshot cache record was not created.')
  }

  const objectStore = createE2EObjectStoreClient()
  const bucket = getE2EObjectStoreBucket()
  await objectStore.send(
    new HeadObjectCommand({ Bucket: bucket, Key: cacheRecord.cloudinaryPublicId })
  )
  const cached = screenshotSchema.parse((await requestJson(page, '/api/screenshot', payload)).body)
  const invalidated = await requestJson(
    page,
    '/api/screenshot/invalidate',
    { url },
    'POST',
    getMaintenanceHeaders()
  )

  expect(first.cached).toBe(false)
  expect(cached).toMatchObject({ cached: true, screenshot: first.screenshot })
  expect(invalidated.status).toBe(200)
  await expect(getCacheRecord(`${first.url}:desktop:light`)).resolves.toBeNull()
  await expect(
    objectStore.send(new HeadObjectCommand({ Bucket: bucket, Key: cacheRecord.cloudinaryPublicId }))
  ).rejects.toMatchObject({ name: 'NotFound' })
  const refreshed = screenshotSchema.parse(
    (await requestJson(page, '/api/screenshot', payload)).body
  )
  expect(refreshed).toMatchObject({ cached: false, screenshot: first.screenshot })
})
