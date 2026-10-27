import assert from 'node:assert/strict'
import test from 'node:test'
import { announcementScheduleSchema, audienceSubscriberCreateSchema } from '@/lib/tenant/schemas'

test('a past schedule time is rejected', () => {
  const releaseDocumentId = 'clh1234567890abcdefghijkl'

  // A past time would be picked up by the very next dispatch tick, which
  // silently turns "schedule for later" into "send now".
  const past = announcementScheduleSchema.safeParse({
    releaseDocumentId,
    scheduledFor: new Date(Date.now() - 60_000),
  })
  assert.equal(past.success, false)

  const future = announcementScheduleSchema.safeParse({
    releaseDocumentId,
    scheduledFor: new Date(Date.now() + 60_000),
  })
  assert.equal(future.success, true)
})

test('omitting the schedule time means send on the next dispatch', () => {
  const parsed = announcementScheduleSchema.safeParse({
    releaseDocumentId: 'clh1234567890abcdefghijkl',
  })

  assert.equal(parsed.success, true)
  assert.equal(parsed.data?.scheduledFor, undefined)
})

test('the call-to-action must be a URL', () => {
  const releaseDocumentId = 'clh1234567890abcdefghijkl'

  // The value is rendered into a link in customer email, so a malformed
  // or javascript: value must not reach the template.
  assert.equal(
    announcementScheduleSchema.safeParse({ ctaUrl: 'not a url', releaseDocumentId }).success,
    false
  )
  assert.equal(
    announcementScheduleSchema.safeParse({
      ctaUrl: 'https://shots.oppulence.io/releases/1',
      releaseDocumentId,
    }).success,
    true
  )
})

test('subscriber addresses are lowercased so consent cannot be bypassed', () => {
  const parsed = audienceSubscriberCreateSchema.safeParse({
    subscribers: [{ email: '  Customer@Example.COM  ', name: 'Ada' }],
  })

  assert.equal(parsed.success, true)
  // Without normalization, unsubscribing customer@example.com would leave
  // Customer@Example.COM subscribed as a separate row.
  assert.equal(parsed.data?.subscribers[0]?.email, 'customer@example.com')
})

test('an empty or malformed audience import is rejected', () => {
  assert.equal(audienceSubscriberCreateSchema.safeParse({ subscribers: [] }).success, false)
  assert.equal(
    audienceSubscriberCreateSchema.safeParse({ subscribers: [{ email: 'not-an-email' }] }).success,
    false
  )
})

test('audience imports are bounded', () => {
  // An unbounded import would build one enormous transaction and could
  // exhaust memory rendering the eventual send.
  const tooMany = Array.from({ length: 1_001 }, (_, index) => ({
    email: `customer${index}@example.com`,
  }))
  assert.equal(audienceSubscriberCreateSchema.safeParse({ subscribers: tooMany }).success, false)

  const atLimit = tooMany.slice(0, 1_000)
  assert.equal(audienceSubscriberCreateSchema.safeParse({ subscribers: atLimit }).success, true)
})
