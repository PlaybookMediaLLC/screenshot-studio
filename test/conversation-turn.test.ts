import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTurnContext,
  type HistoryMessage,
  mayAskClarification,
  RECENT_MESSAGES,
} from '@/lib/ai/conversation/context'
import { describeStep, type DescribableStep, isRetryableStep } from '@/lib/ai/conversation/steps'

const user = (content: string): HistoryMessage => ({ content, kind: 'text', role: 'user' })
const assistant = (content: string, kind: HistoryMessage['kind'] = 'text'): HistoryMessage => ({
  content,
  kind,
  role: 'assistant',
})

test('the agent asks at most once: not right after its own question', () => {
  assert.equal(mayAskClarification([user('We shipped recurring invoices.')]), true)
  const asked = [
    user('We shipped recurring invoices.'),
    assistant('Which page shows recurring invoices?\n- Invoices\n- Billing', 'clarification'),
    user('Not sure.'),
  ]
  assert.equal(mayAskClarification(asked), false)
  const { system } = buildTurnContext({ context: [], history: asked })
  assert.match(system, /you already asked a question/i)
  assert.doesNotMatch(system, /call askClarification once/)
  // After an answered question and a normal reply, a later turn may ask again.
  assert.equal(mayAskClarification([...asked, assistant('I used the Invoices page.')]), true)
})

test('trimming a long conversation keeps the product context and the recent turns', () => {
  const product = '<product_profile>\nName: Ledgerly\n</product_profile>'
  const history = Array.from({ length: 200 }, (_, index) =>
    index % 2 === 0 ? user(`Message ${index} ${'x'.repeat(3_000)}`) : assistant(`Reply ${index}`)
  )
  const { messages, system } = buildTurnContext({ context: [product, null], history })
  assert.ok(system.includes(product))
  // A trimmed summary, then the recent messages in full.
  assert.equal(messages.length, RECENT_MESSAGES + 1)
  assert.match(String(messages[0]!.content), /^Earlier in this conversation/)
  assert.ok(String(messages[0]!.content).length < 2_200)
  assert.equal(messages.at(-1)!.content, 'Reply 199')
  // Tool anchors never reach the model.
  const anchored = buildTurnContext({
    context: [product],
    history: [user('Hi'), { content: 'Agent run', kind: 'tool', role: 'tool' }],
  })
  assert.deepEqual(anchored.messages, [{ content: 'Hi', role: 'user' }])
})

const step = (overrides: Partial<DescribableStep>): DescribableStep => ({
  errorCode: null,
  id: 'step_1',
  index: 0,
  outputSummary: null,
  status: 'SUCCEEDED',
  toolName: 'generateCampaign',
  ...overrides,
})

test('transient failures offer a retry; permanent ones a corrective action, in plain words', () => {
  const timeout = step({ errorCode: 'timeout', status: 'FAILED' })
  assert.equal(isRetryableStep(timeout), true)
  assert.deepEqual(describeStep(timeout, [timeout]), {
    action: 'retry',
    id: 'step_1',
    index: 0,
    label: 'Draft the spec, plan, and posts',
    reason: 'This took too long.',
    status: 'FAILED',
  })
  assert.equal(isRetryableStep(step({ errorCode: 'failed', status: 'FAILED' })), true)

  const denied = step({ errorCode: 'denied', status: 'DENIED' })
  assert.equal(isRetryableStep(denied), false)
  assert.equal(describeStep(denied, [denied]).action, 'ask_admin')
  assert.doesNotMatch(describeStep(denied, [denied]).reason!, /DENIED/)

  const noProduct = step({
    errorCode: 'rejected',
    outputSummary: { error: 'Add your product before creating a campaign.', fix: 'onboarding' },
    status: 'FAILED',
    toolName: 'createCampaign',
  })
  assert.equal(isRetryableStep(noProduct), false)
  assert.equal(describeStep(noProduct, [noProduct]).action, 'onboarding')
  assert.equal(
    describeStep(noProduct, [noProduct]).reason,
    'Add your product before creating a campaign.'
  )

  // A question is never retried; a recovered step no longer offers a retry.
  assert.equal(
    isRetryableStep(step({ errorCode: 'timeout', status: 'FAILED', toolName: 'askClarification' })),
    false
  )
  const recovered = step({ id: 'step_2', index: 1, status: 'SUCCEEDED' })
  assert.equal(isRetryableStep(timeout, [timeout, recovered]), false)
  assert.equal(describeStep(timeout, [timeout, recovered]).action, null)
})

/** Runs the scripted model against stand-in tools named like the conversation's. */
async function scriptedTurn(surfaces: Array<{ name: string; reason: string; slug: string }>) {
  const { generateText, stepCountIs, tool } = await import('ai')
  const { z } = await import('zod')
  const { createScriptedModel } = await import('@/lib/ai/models/scripted')
  const called: Array<{ input: unknown; name: string }> = []
  const stub = (name: string, output: unknown) =>
    tool({
      execute: async (input: unknown) => {
        called.push({ input, name })
        return output
      },
      inputSchema: z.object({}).passthrough(),
    })
  const result = await generateText({
    messages: [{ content: 'We just shipped recurring invoices. Market it.', role: 'user' }],
    model: createScriptedModel('test'),
    stopWhen: [stepCountIs(8), () => called.some((call) => call.name === 'askClarification')],
    tools: {
      askClarification: stub('askClarification', { asked: true, ok: true }),
      createCampaign: stub('createCampaign', {
        campaignId: 'c1',
        created: true,
        name: 'recurring invoices launch',
        ok: true,
        surface: 'Invoices',
      }),
      generateCampaign: stub('generateCampaign', { assetCount: 2, ok: true, postCount: 7 }),
      getBrand: stub('getBrand', { ok: true }),
      getProduct: stub('getProduct', { ok: true }),
      listProductSurfaces: stub('listProductSurfaces', { ok: true, surfaces }),
      requestApproval: stub('requestApproval', { ok: true }),
    },
  })
  return { called: called.map((call) => call.name), result }
}

test('the scripted agent creates and drafts on one match, and asks once on several', async () => {
  const one = await scriptedTurn([{ name: 'Invoices', reason: 'tag', slug: 'invoices' }])
  assert.deepEqual(one.called, [
    'getProduct',
    'getBrand',
    'listProductSurfaces',
    'createCampaign',
    'generateCampaign',
  ])
  assert.match(one.result.text, /I created the campaign/)
  assert.match(one.result.text, /I assumed/)
  const several = await scriptedTurn([
    { name: 'Invoices', reason: 'tag', slug: 'invoices' },
    { name: 'Billing', reason: 'name', slug: 'billing' },
  ])
  assert.equal(several.called.at(-1), 'askClarification')
  assert.ok(!several.called.includes('createCampaign'))
})
