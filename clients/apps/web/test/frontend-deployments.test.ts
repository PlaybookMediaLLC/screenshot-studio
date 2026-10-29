import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { frontendSourceSchema, frontendPolicySchema } from 'screenshot-studio-backend-sdk'
import { frontendWebhookContract } from '@/lib/api/contracts/webhooks'
import { route } from '@/lib/api/route'
import { deploymentExample } from '@/lib/workflows/deployment-examples'

const policy = frontendPolicySchema.parse({
  schemaVersion: 1,
  environments: ['production'],
  branch: '',
  tag: '',
  domain: '',
  workflowId: '',
  job: '',
  checks: [],
  alerts: ['matched'],
  workflowVersionId: '',
})

test('frontend facade preserves signed UTF-8 whitespace and bounds streamed bodies', async (t) => {
  t.mock.method(console, 'info', () => undefined)
  let received = ''
  const handler = route(frontendWebhookContract, {
    auth: async () => ({}),
    handler: async ({ body }) => {
      received = body
      return { accepted: true as const }
    },
  })
  const body = '{ "name": "déploy", "id": "1" }\n'
  const context = { params: Promise.resolve({ id: 'source1' }) }
  const response = await handler(
    new NextRequest('https://shots.test/api/webhooks/frontends/source1', { method: 'POST', body }),
    context
  )
  assert.equal(response.status, 202)
  assert.equal(received, body)
  received = ''
  const oversized = await handler(
    new NextRequest('https://shots.test/api/webhooks/frontends/source1', {
      method: 'POST',
      body: 'x'.repeat(1024 * 1024 + 1),
    }),
    context
  )
  assert.equal(oversized.status, 413)
  assert.equal(received, '')
})

test('preview examples distinguish workflow/build evidence from activation', () => {
  assert.equal(deploymentExample('vercel', 'build', policy).production, 'pending')
  assert.equal(deploymentExample('github', 'workflow', policy).deploymentId, '')
  assert.equal(deploymentExample('vercel', 'rollback', policy).production, 'pending')
  assert.equal(deploymentExample('vercel', 'active', policy).workflowLinked, false)
  assert.equal(frontendSourceSchema.shape.hasToken.parse(true), true)
  assert.equal('token' in frontendSourceSchema.shape, false)
  assert.equal('secret' in frontendSourceSchema.shape, false)
})
