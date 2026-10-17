import assert from 'node:assert/strict'
import test from 'node:test'
import { scrubEvent, scrubUrl } from '@/lib/analytics-scrub'
import { adsAllowed } from '@/lib/consent'

test('share, review, invitation and reset secrets never reach analytics', () => {
  assert.equal(
    scrubUrl('https://shots.example/s/abc123/embed?x=1'),
    'https://shots.example/s/[redacted]/embed?x=1'
  )
  assert.equal(
    scrubUrl('/en/review/tok_9?invitationId=inv1&ok=1'),
    '/en/review/[redacted]?invitationId=[redacted]&ok=1'
  )
  assert.equal(scrubUrl('/reset-password?token=secret#top'), '/reset-password?token=[redacted]#top')
  assert.equal(scrubUrl('/sign-in?callbackURL=%2Fs%2Fabc'), '/sign-in?callbackURL=[redacted]')
  assert.equal(scrubUrl('/settings/security'), '/settings/security')

  const event = scrubEvent({
    properties: { $current_url: '/s/abc', count: 2 },
    $set: { $referrer: '/review/x' },
  })
  assert.deepEqual(event, {
    properties: { $current_url: '/s/[redacted]', count: 2 },
    $set: { $referrer: '/review/[redacted]' },
  })
})

test('ads load only after an explicit yes', () => {
  assert.equal(adsAllowed(null), false)
  assert.equal(adsAllowed({ analytics: true, ads: false }), false)
  assert.equal(adsAllowed({ analytics: false, ads: true }), true)
})
