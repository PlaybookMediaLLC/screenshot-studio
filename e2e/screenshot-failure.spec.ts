import { randomUUID } from 'node:crypto'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabaseClient } from './framework/services'

type FailureCase = {
  path: 'timeout' | 'unavailable' | 'invalid-image'
  status: number
}

const failures: readonly FailureCase[] = [
  { path: 'timeout', status: 408 },
  { path: 'unavailable', status: 503 },
  { path: 'invalid-image', status: 500 },
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

test('failed screenshot captures return safe errors and never leave cache records', async ({
  app,
  page,
}) => {
  await app.open('/sign-in')
  const identifier = randomUUID()

  for (const failure of failures) {
    const url = `https://e2e-screenshot.example/${identifier}/${failure.path}`
    const response = await requestJson(
      page,
      '/api/screenshot',
      { colorScheme: 'light', deviceType: 'desktop', url },
      'POST',
      { 'x-forwarded-for': `e2e-screenshot-${identifier}-${failure.path}` }
    )

    expect(response.status).toBe(failure.status)
    expect(response.body).toMatchObject({ error: expect.any(String) })
    await expect(getCacheRecord(`${url}:desktop:light`)).resolves.toBeNull()
  }
})
