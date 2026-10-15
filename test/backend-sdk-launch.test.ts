import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BackendSDKError,
  ScreenshotStudioBackendSDK,
} from '../packages/screenshot-studio-backend-sdk/src'

test('launch SDK sends scoped requests to the launch routes', async () => {
  const requests: { body?: unknown; method?: string; path: string }[] = []
  const sdk = new ScreenshotStudioBackendSDK(
    'https://backend.example',
    'service-secret',
    { organizationId: 'org-1', requestId: 'req-1', sessionId: 'session-1', userId: 'user-1' },
    async (input, init) => {
      const path = new URL(String(input)).pathname
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method,
        path,
      })
      if (path.endsWith('/approve')) {
        return Response.json({ error: 'Spec not found.' }, { status: 404 })
      }
      if (path.endsWith('/runs')) {
        return Response.json(
          { error: 'This step is already running for the campaign.' },
          { status: 409 }
        )
      }
      return Response.json({ designIds: [], revision: { id: 'revision/1' } })
    }
  )

  await sdk.saveLaunchSpec('release/1', {
    changeSummary: 'Drafted',
    content: { summary: {} },
    metadata: { steps: 2 },
    origin: 'ai',
    sources: [],
  })
  await sdk.applyLaunchRevision('revision/1', { designDocuments: {}, related: [0] })
  await sdk.finishLaunchRun('run-1', { status: 'SUCCEEDED', summary: 'Done' })
  await sdk.setLaunchDesignCritique('design-1', { verdict: 'pass' })
  await assert.rejects(
    sdk.approveLaunchSpec('spec-1'),
    (error: unknown) =>
      error instanceof BackendSDKError &&
      error.status === 404 &&
      error.message === 'Spec not found.'
  )
  await assert.rejects(
    sdk.startLaunchRun('campaign-1', 'spec'),
    (error: unknown) => error instanceof BackendSDKError && error.status === 409
  )

  assert.deepEqual(
    requests.map(({ method, path }) => `${method} ${path}`),
    [
      'POST /v1/launch/releases/release%2F1/specs',
      'POST /v1/launch/revisions/revision%2F1/apply',
      'POST /v1/launch/runs/run-1/finish',
      'PUT /v1/launch/designs/design-1/critique',
      'POST /v1/launch/specs/spec-1/approve',
      'POST /v1/launch/campaigns/campaign-1/runs',
    ]
  )
  assert.deepEqual(requests[1].body, { designDocuments: {}, related: [0] })
  assert.deepEqual(requests[3].body, { critique: { verdict: 'pass' } })
  assert.deepEqual(requests[5].body, { kind: 'spec' })
  assert.equal(requests[4].body, undefined)
})
