import { z } from 'zod'
import { signUpAndCreateWorkspace } from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { trpcMutation } from './framework/trpc'
import { configureE2EFlow, expect, test } from './framework/flow'

const apiKeySchema = z.object({ apiKey: z.object({ id: z.string(), key: z.string().min(1) }) })
const releaseSchema = z.object({ id: z.string().uuid(), title: z.string() })
const releaseResultSchema = z.object({ created: z.boolean(), release: releaseSchema })
const releaseListSchema = z.object({ releases: z.array(releaseSchema) })

configureE2EFlow()

test('an API key creates idempotent releases only for its workspace and stops after revocation', async ({
  browser,
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const key = apiKeySchema.parse(
    (
      await trpcMutation(page, 'apiKey.create', {
        name: 'Release automation',
        scopes: ['artifact:read', 'release:create'],
      })
    ).body
  ).apiKey
  const keyHeaders = { 'x-api-key': key.key }
  const releaseInput = { benefitStatement: 'Ship clearer launch content.', title: 'E2E release' }
  const first = await requestJson(page, '/api/tenant/releases', releaseInput, 'POST', {
    ...keyHeaders,
    'idempotency-key': 'e2e-release-key',
  })
  const duplicate = await requestJson(page, '/api/tenant/releases', releaseInput, 'POST', {
    ...keyHeaders,
    'idempotency-key': 'e2e-release-key',
  })
  const firstRelease = releaseResultSchema.parse(first.body)
  const duplicateRelease = releaseResultSchema.parse(duplicate.body)

  expect(first.status).toBe(201)
  expect(duplicate.status).toBe(200)
  expect(duplicateRelease.created).toBe(false)
  expect(duplicateRelease.release.id).toBe(firstRelease.release.id)

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  try {
    await signUpAndCreateWorkspace(
      {
        ...identity,
        email: `other-${identity.email}`,
        workspaceName: `Other ${identity.workspaceName}`,
      },
      otherPage
    )
    await requestJson(otherPage, '/api/tenant/releases', {
      benefitStatement: 'Must remain private.',
      title: 'Other workspace release',
    })
    const releases = releaseListSchema.parse(
      (await browserRequest(page, '/api/tenant/releases', { headers: keyHeaders })).body
    ).releases

    expect(releases).toContainEqual(expect.objectContaining({ id: firstRelease.release.id }))
    expect(releases).not.toContainEqual(
      expect.objectContaining({ title: 'Other workspace release' })
    )
  } finally {
    await otherContext.close()
  }

  expect((await trpcMutation(page, 'apiKey.revoke', { keyId: key.id })).status).toBe(200)
  expect((await browserRequest(page, '/api/tenant/releases', { headers: keyHeaders })).status).toBe(
    403
  )
})
