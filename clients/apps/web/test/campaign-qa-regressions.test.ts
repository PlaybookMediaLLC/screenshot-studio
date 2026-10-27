import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignPostReviewIssue } from '@/lib/launch/guards'
import { parseSection } from '@/lib/launch/spec-text'
import { campaignApprovalSchema, releaseCreateSchema } from '@/lib/tenant/schemas'
import { briefValidationMessage, normalizeProductUrl } from '@/lib/campaigns/brief-form'

test('review checks count CTA and emoji and honor each launch channel limit', () => {
  assert.equal(
    campaignPostReviewIssue({ channel: 'x', copy: 'x'.repeat(280), callToAction: null }),
    null
  )
  assert.match(
    campaignPostReviewIssue({ channel: 'x', copy: 'x'.repeat(278), callToAction: '🚀' })!,
    /281\/280/
  )
  assert.equal(
    campaignPostReviewIssue({ channel: 'email', copy: 'x'.repeat(5000), callToAction: null }),
    null
  )
  assert.match(
    campaignPostReviewIssue({ channel: 'instagram', copy: 'x'.repeat(2201), callToAction: null })!,
    /2201\/2200/
  )
})

test('change requests need a useful note, including extended RPC schemas', () => {
  for (const note of [undefined, '', '   '])
    assert.equal(
      campaignApprovalSchema.safeParse({ decision: 'request_changes', note }).success,
      false
    )
  assert.equal(
    campaignApprovalSchema.parse({ decision: 'request_changes', note: ' Fix the headline. ' }).note,
    'Fix the headline.'
  )
  assert.equal(campaignApprovalSchema.safeParse({ decision: 'approve' }).success, true)
})

test('brief validation identifies the field before any product writes', () => {
  const parsed = releaseCreateSchema.safeParse({
    title: '  ',
    description: '<Stripe>',
    benefitStatement: 'Useful',
  })
  assert.equal(parsed.success, false)
  if (!parsed.success) {
    assert.match(briefValidationMessage(parsed.error), /Release title/)
    assert.match(briefValidationMessage(parsed.error), /Description: Use plain text/)
  }
  assert.equal(normalizeProductUrl(' example.com '), 'https://example.com')
  assert.equal(normalizeProductUrl('http://example.com'), 'http://example.com')
})

test('editing after a source tag keeps citations structured instead of literal text', () => {
  assert.deepEqual(parseSection('summary', 'Recurring invoices [brief]. More detail [S1].'), {
    ok: true,
    value: { text: 'Recurring invoices. More detail.', sources: ['brief', 'S1'] },
  })
  assert.equal(parseSection('summary', 'Claim [unknown] followed by more text.').ok, false)
})
