import assert from 'node:assert/strict'
import test from 'node:test'
import { renderTemplate } from '@/lib/email/render'
import { chunk, RESEND_BATCH_LIMIT } from '@/lib/email/batching'
import { AuthActionEmail } from '@/lib/email/templates/auth-action'
import { InvitationEmail } from '@/lib/email/templates/invitation'
import { ReleaseAnnouncementEmail } from '@/lib/email/templates/release-announcement'

test('rendering produces both an HTML and a plaintext part', async () => {
  const { html, text } = await renderTemplate(
    AuthActionEmail({
      actionUrl: 'https://shots.oppulence.io/verify?token=abc',
      kind: 'verify-email',
    })
  )

  assert.match(html, /<html/i)
  // A message with no text alternative scores worse with spam filters and
  // is unreadable in terminal clients.
  assert.ok(text.length > 0)
  assert.doesNotMatch(text, /<[a-z]/i)
  // The action URL has to survive into both parts, or the recipient
  // cannot complete the action from a client that strips HTML.
  assert.match(html, /token=abc/)
  assert.match(text, /token=abc/)
})

test('transactional mail carries no unsubscribe link', async () => {
  const { html } = await renderTemplate(
    InvitationEmail({
      acceptUrl: 'https://shots.oppulence.io/accept-invitation?invitationId=1',
      inviterName: 'Ada',
      organizationName: 'Playbook',
    })
  )

  // Offering to opt out of an invitation is nonsense, and opting out of
  // password resets would lock the recipient out of recovery.
  assert.doesNotMatch(html, /unsubscribe/i)
})

test('announcement mail carries the unsubscribe link and postal address', async () => {
  const { html, text } = await renderTemplate(
    ReleaseAnnouncementEmail({
      benefitStatement: 'Exports are twice as fast.',
      bodyMarkdown: 'We rebuilt the export pipeline.',
      postalAddress: 'Playbook Media LLC, 1 Main St, Newark, NJ',
      productName: 'Screenshot Studio',
      title: 'Faster exports',
      unsubscribeUrl: 'https://shots.oppulence.io/unsubscribe?token=xyz',
    })
  )

  // CAN-SPAM requires both on commercial mail, and Gmail and Yahoo
  // require a working unsubscribe from bulk senders.
  assert.match(html, /unsubscribe\?token=xyz/)
  assert.match(html, /Playbook Media LLC/)
  assert.match(text, /unsubscribe\?token=xyz/i)
})

test('tenant-supplied release bodies cannot inject markup', async () => {
  const { html } = await renderTemplate(
    ReleaseAnnouncementEmail({
      benefitStatement: 'Safe',
      bodyMarkdown: '<script>alert(1)</script>\n\nSecond paragraph',
      productName: 'Screenshot Studio',
      title: 'Escaping',
      unsubscribeUrl: 'https://shots.oppulence.io/unsubscribe?token=xyz',
    })
  )

  // Release bodies are tenant-authored, so raw markup must be escaped
  // rather than rendered into the message.
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Second paragraph/)
})

test('bulk sends are chunked at the provider batch limit', () => {
  const recipients = (count: number) => Array.from({ length: count }, (_, index) => index)

  // Resend rejects a batch larger than 100, so the boundary is where a
  // release announcement to a real audience would silently fail.
  assert.equal(chunk(recipients(99), RESEND_BATCH_LIMIT).length, 1)
  assert.equal(chunk(recipients(100), RESEND_BATCH_LIMIT).length, 1)
  assert.equal(chunk(recipients(101), RESEND_BATCH_LIMIT).length, 2)
  assert.equal(chunk(recipients(250), RESEND_BATCH_LIMIT).length, 3)

  // No recipient may be dropped or duplicated across chunks.
  const chunks = chunk(recipients(250), RESEND_BATCH_LIMIT)
  assert.equal(chunks.flat().length, 250)
  assert.equal(new Set(chunks.flat()).size, 250)
  assert.equal(chunks.at(-1)?.length, 50)
})

test('chunking an empty audience yields no requests', () => {
  assert.deepEqual(chunk([], RESEND_BATCH_LIMIT), [])
  assert.throws(() => chunk([1, 2], 0))
})
