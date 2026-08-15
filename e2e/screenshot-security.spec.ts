import { randomUUID } from 'node:crypto'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { startHttpMockServer } from './framework/http-server'
import { createE2EDatabaseClient } from './framework/services'

const unsafeUrls = [
  'http://127.0.0.1',
  'http://localhost',
  'http://[::1]',
  'http://169.254.169.254',
]

async function getCacheRecord(url: string) {
  const database = createE2EDatabaseClient()
  try {
    return await database.screenshotCache.findFirst({ where: { url } })
  } finally {
    await database.$disconnect()
  }
}

configureE2EFlow()

test('capture rejects local and private network targets before a remote capture starts', async ({
  app,
  page,
}) => {
  await app.open('/sign-in')

  for (const url of unsafeUrls) {
    const response = await requestJson(
      page,
      '/api/screenshot',
      { colorScheme: 'light', deviceType: 'desktop', url },
      'POST',
      { 'x-forwarded-for': `e2e-private-target-${randomUUID()}` }
    )

    expect(response).toMatchObject({
      body: { error: 'This address cannot be captured.' },
      status: 400,
    })
    await expect(getCacheRecord(`${url}:desktop:light`)).resolves.toBeNull()
  }
})

test('capture does not follow a provider image redirect into a private network', async ({
  app,
  page,
}) => {
  const imageServer = await startHttpMockServer(() => ({
    headers: { location: 'http://127.0.0.1/private-image' },
    status: 302,
  }))
  const port = new URL(imageServer.url).port
  const url = `https://e2e-screenshot.example/${randomUUID()}/redirect-private?port=${port}`

  try {
    await app.open('/sign-in')
    const response = await requestJson(
      page,
      '/api/screenshot',
      { colorScheme: 'light', deviceType: 'desktop', url },
      'POST',
      { 'x-forwarded-for': `e2e-redirect-${randomUUID()}` }
    )

    expect(response).toMatchObject({ body: { error: expect.any(String) }, status: 500 })
    expect(imageServer.calls).toHaveLength(1)
    await expect(getCacheRecord(`${url}:desktop:light`)).resolves.toBeNull()
  } finally {
    await imageServer.close()
  }
})

test('capture refuses an oversized provider image without caching it', async ({ app, page }) => {
  const imageServer = await startHttpMockServer(() => ({ rawBody: Buffer.alloc(11 * 1024 * 1024) }))
  const port = new URL(imageServer.url).port
  const url = `https://e2e-screenshot.example/${randomUUID()}/oversized-image?port=${port}`

  try {
    await app.open('/sign-in')
    const response = await requestJson(
      page,
      '/api/screenshot',
      { colorScheme: 'light', deviceType: 'desktop', url },
      'POST',
      { 'x-forwarded-for': `e2e-oversized-${randomUUID()}` }
    )

    expect(response).toMatchObject({ body: { error: expect.any(String) }, status: 500 })
    expect(imageServer.calls).toHaveLength(1)
    await expect(getCacheRecord(`${url}:desktop:light`)).resolves.toBeNull()
  } finally {
    await imageServer.close()
  }
})
