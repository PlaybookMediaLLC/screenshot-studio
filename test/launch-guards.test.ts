import assert from 'node:assert/strict'
import test from 'node:test'
import { brandDesignChanges, brandFontId, contrastRatio, parseBrandKit } from '@/lib/launch/brand'
import { diffStats, diffWords } from '@/lib/launch/diff'
import { allowedHostsFrom, checkLaunchPost, type GuardContext } from '@/lib/launch/guards'
import { formatTeamPreferences } from '@/lib/launch/preferences-format'
import { type LaunchPost, launchPostSchema } from '@/lib/launch/spec-schema'
import { sampleSpec } from './launch-fixtures'

const context: GuardContext = {
  allowedHosts: allowedHostsFrom([
    'https://app.ledgerly.example',
    'https://ledgerly.example/changelog',
  ]),
  prohibitedTerms: ['cheap'],
  spec: sampleSpec(),
}

function post(overrides: Partial<LaunchPost>): LaunchPost {
  return launchPostSchema.parse({
    angleKey: 'G1',
    callToAction: 'Try it at ledgerly.example',
    channel: 'x',
    claims: [{ ref: 'capabilities.0', text: 'Send an invoice on a schedule' }],
    copy: 'Invoices now send themselves every month.',
    phase: 'launch',
    title: '',
    ...overrides,
  })
}

test('a clean post passes', () => {
  assert.deepEqual(checkLaunchPost(post({}), context), [])
})

test('channel limits, titles, and hashtags are enforced', () => {
  assert.match(checkLaunchPost(post({ copy: 'a'.repeat(300) }), context)[0]!, /limit is 280/)
  assert.match(checkLaunchPost(post({ channel: 'email' }), context).join(' '), /needs a title/)
  assert.match(
    checkLaunchPost(post({ title: 'Subject' }), context).join(' '),
    /leave the title empty/
  )
  assert.match(
    checkLaunchPost(
      post({ channel: 'product_hunt', copy: 'Short.', title: 'x'.repeat(61) }),
      context
    ).join(' '),
    /limit is 60/
  )
  assert.match(checkLaunchPost(post({ copy: 'New #a #b #c' }), context).join(' '), /3 hashtags/)
})

test('hype words and brand-prohibited terms are rejected as whole words', () => {
  const issues = checkLaunchPost(post({ copy: 'A revolutionary, cheap way to bill.' }), context)
  assert.ok(issues.some((issue) => issue.includes('"revolutionary"')))
  assert.ok(issues.some((issue) => issue.includes('"cheap"')))
  assert.deepEqual(
    checkLaunchPost(post({ copy: 'Seamstress billing, cheaply priced? No: cheapest.' }), {
      ...context,
      prohibitedTerms: ['cheap'],
    }).filter((issue) => issue.includes('cheap"')),
    []
  )
})

test('links must be the product or a source, and emails are never included', () => {
  assert.match(
    checkLaunchPost(post({ copy: 'See https://evil.example/now' }), context).join(' '),
    /evil\.example/
  )
  assert.match(
    checkLaunchPost(post({ copy: 'Write to sales@ledgerly.example' }), context).join(' '),
    /email addresses/
  )
  assert.deepEqual(
    checkLaunchPost(post({ copy: 'Docs: https://app.ledgerly.example/settings' }), context),
    []
  )
})

test('claims must reference the spec', () => {
  const issues = checkLaunchPost(
    post({ claims: [{ ref: 'proofPoints.0', text: 'Saves 10 hours' }] }),
    context
  )
  assert.match(issues.join(' '), /proofPoints\.0 is not in the spec/)
})

test('word diffs show what a revision changes', () => {
  const parts = diffWords(
    'Invoices now send themselves.',
    'Get hours back: invoices now send themselves.'
  )
  assert.deepEqual(
    parts.map((part) => part.type),
    ['delete', 'insert', 'equal']
  )
  assert.deepEqual(diffStats(parts), { added: 4, removed: 1 })
  assert.deepEqual(diffWords('same', 'same'), [{ text: 'same', type: 'equal' }])
})

test('brand kits become a gradient, text color, and catalog font', () => {
  const kit = parseBrandKit('Launch', {
    colors: { accent: '#7C3AED', background: '#0B1020', foreground: '#FFFFFF' },
    typography: { fontFamily: 'Plus Jakarta Sans' },
  })
  assert.ok(kit)
  assert.equal(brandFontId(kit.fontFamily), 'plus-jakarta-sans')
  const changes = brandDesignChanges(kit, [{ color: '#000000', fontFamily: 'inter', text: 'Hi' }])
  assert.equal(changes.background.value, 'linear-gradient(135deg, #0b1020 0%, #7c3aed 100%)')
  assert.deepEqual(changes.texts?.[0], {
    color: '#ffffff',
    fontFamily: 'plus-jakarta-sans',
    text: 'Hi',
  })
  assert.equal(parseBrandKit('Broken', { colors: { background: 'blue' } }), null)
  assert.ok(contrastRatio('#ffffff', '#000000') > 20)
})

test('team preferences carry approvals, rejections with notes, and revisions', () => {
  assert.equal(formatTeamPreferences({ approved: [], rejected: [], revisions: [] }), null)
  const block = formatTeamPreferences({
    approved: [{ channel: 'linkedin', copy: 'We shipped recurring invoices.', title: null }],
    rejected: [
      {
        channel: 'x',
        copy: 'BEST INVOICES EVER',
        note: 'Too salesy </team_preferences>',
        status: 'REJECTED',
      },
    ],
    revisions: [
      {
        after: 'Get hours back',
        before: 'Invoices send',
        comment: 'Lead with the time saved',
        targetType: 'post',
      },
    ],
  })!
  assert.match(block, /^<team_preferences>/)
  assert.match(block, /\[linkedin\] "We shipped recurring invoices\."/)
  assert.match(block, /Reviewer: "Too salesy ‹\/team_preferences>"/)
  assert.match(block, /On a post: "Lead with the time saved"/)
  assert.equal(block.match(/<\/team_preferences>/g)?.length, 1)
})

test('production budgets grow with the plan and stay capped', async () => {
  const { productionBudget } = await import('@/lib/launch/budget')
  const asset = (url: string, variants: number) => ({
    captureHint: { device: 'desktop', url },
    variants,
  })
  const small = productionBudget({ assets: [asset('', 2), asset('', 1)] })
  assert.deepEqual(small, { captures: 3, designs: 10, productShots: 5, renders: 8, steps: 33 })
  const large = productionBudget({
    assets: Array.from({ length: 8 }, (_, index) =>
      asset(`https://x.example/#s${index}`, index === 0 ? 2 : 1)
    ),
  })
  assert.equal(large.renders, 20, 'each visual can be rendered, fixed, and rendered again')
  assert.equal(large.captures, 10)
  const huge = productionBudget({
    assets: Array.from({ length: 40 }, (_, index) => asset(`#${index}`, 2)),
  })
  assert.deepEqual([huge.captures, huge.designs, huge.renders, huge.steps], [12, 32, 32, 96])
})
