import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { planTargetLine } from '@/lib/ai/launch/prompts'
import { createScriptedModel } from '@/lib/ai/models/scripted'
import { formatBrief } from '@/lib/launch/sources'
import {
  campaignPlanSchema,
  type CampaignPlanContent,
  launchPostSchema,
  listSpecClaims,
  releaseSpecSchema,
  validatePlanReferences,
} from '@/lib/launch/spec-schema'
import { planTargetIssues, targetChannels } from '@/lib/onboarding/plan-target'

const HOME = 'https://acme.example/'

function plan(timeline: Array<{ channel: CampaignPlanContent['channels'][number]['channel'] }>) {
  return {
    channels: [...new Set(timeline.map((item) => item.channel))].map((channel) => ({ channel })),
    timeline,
  } as unknown as CampaignPlanContent
}

test('a targeted plan needs exactly its post count on its channels', () => {
  const target = { channels: targetChannels([]), timelineItems: 7 }
  assert.deepEqual(target.channels, ['x', 'linkedin'])
  const seven = Array.from({ length: 7 }, (_, index) => ({
    channel: index % 2 ? ('linkedin' as const) : ('x' as const),
  }))
  assert.deepEqual(planTargetIssues(plan(seven), target), [])
  assert.match(planTargetIssues(plan(seven.slice(1)), target)[0]!, /has 6 items; plan exactly 7/)
  const email = planTargetIssues(plan([...seven.slice(1), { channel: 'email' }]), target)
  assert.ok(email.some((issue) => issue.startsWith('Remove email')))
  assert.ok(email.some((issue) => issue.startsWith('Timeline item 7 posts to email')))
})

test('a first campaign uses the connected first-campaign channels when there are any', () => {
  const x = { platform: 'x', status: 'ACTIVE' }
  assert.deepEqual(targetChannels([x]), ['x'])
  assert.deepEqual(targetChannels([{ platform: 'linkedin', status: 'REVOKED' }]), ['x', 'linkedin'])
  assert.deepEqual(targetChannels([x, { platform: 'linkedin', status: 'ACTIVE' }]), [
    'x',
    'linkedin',
  ])
})

async function submission(tool: string, text: string): Promise<unknown> {
  const result = await createScriptedModel('test').doGenerate({
    prompt: [{ content: [{ text, type: 'text' }], role: 'user' }],
    tools: [{ inputSchema: { properties: {}, type: 'object' }, name: tool, type: 'function' }],
  } as unknown as LanguageModelV4CallOptions)
  const call = result.content.find((part) => part.type === 'tool-call')
  assert.ok(call && call.type === 'tool-call', `${tool} was called`)
  return JSON.parse(call.input)
}

test('the scripted plan honors a seven-post target and writes one post per item', async () => {
  const brief = formatBrief({
    answers: [],
    audience: 'Agencies',
    benefitStatement: 'Invoices send themselves.',
    description: null,
    productName: 'Acme',
    productUrl: HOME,
    sourceUrls: [],
    title: 'Acme launch',
  })
  const spec = releaseSpecSchema.parse(
    await submission('submitSpec', `${brief}\n\nYou may cite: brief.\n\nWrite the launch spec.`)
  )
  const claims = listSpecClaims(spec)
    .map((claim) => `- ${claim.ref}: ${claim.text}`)
    .join('\n')
  const specBlock = `<spec version="1">\nSummary: ${spec.summary.text}\nClaims (cite these refs):\n${claims}\n</spec>`
  const target = { channels: targetChannels([]), timelineItems: 7 }
  const content = campaignPlanSchema.parse(
    await submission(
      'submitPlan',
      `${specBlock}\n\n<capture_urls>\n${HOME}\n</capture_urls>\n\n${planTargetLine(target)}\n\nPlan the launch campaign.`
    )
  )
  assert.deepEqual(planTargetIssues(content, target), [])
  assert.deepEqual(validatePlanReferences(content, spec, [HOME]), [])

  const planBlock = `<plan version="1">\n${JSON.stringify(content, null, 1)}\n</plan>`
  const posts: unknown[] = []
  for (const channel of target.channels) {
    const copy = (await submission(
      'saveLaunchCopy',
      `${specBlock}\n\n${planBlock}\n\nWrite the ${channel} posts: one for each ${channel} item.`
    )) as { posts: unknown[] }
    posts.push(...copy.posts)
  }
  assert.equal(posts.length, 7)
  const copies = posts.map((post) => launchPostSchema.parse(post).copy)
  assert.equal(new Set(copies).size, 7, 'every post says something different')
})
