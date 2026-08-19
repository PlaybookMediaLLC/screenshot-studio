import 'server-only'

import { AuthActionEmail } from '@/lib/email/templates/auth-action'
import { InvitationEmail } from '@/lib/email/templates/invitation'
import { renderTemplate } from '@/lib/email/render'
import { sendAuthEmail } from './email'

/**
 * Templated authentication email.
 *
 * These messages are transactional: verification, password reset, and
 * invitation are responses to a user action and carry no unsubscribe
 * link, because a recipient who opted out of announcements still needs to
 * be able to reset their password or accept an invitation.
 *
 * Each send passes both the rendered HTML and a plaintext fallback. The
 * fallback matters beyond spam scoring: the webhook transport in
 * `email.ts` is plaintext-only, so a deployment using its own mail
 * service still receives a usable message.
 */

export async function sendVerificationEmail(input: {
  actionUrl: string
  to: string
}): Promise<void> {
  const { html, text } = await renderTemplate(
    AuthActionEmail({ actionUrl: input.actionUrl, kind: 'verify-email' })
  )

  await sendAuthEmail({
    html,
    subject: 'Verify your Screenshot Studio email',
    text,
    to: input.to,
  })
}

export async function sendPasswordResetEmail(input: {
  actionUrl: string
  to: string
}): Promise<void> {
  const { html, text } = await renderTemplate(
    AuthActionEmail({ actionUrl: input.actionUrl, kind: 'reset-password' })
  )

  await sendAuthEmail({
    html,
    subject: 'Reset your Screenshot Studio password',
    text,
    to: input.to,
  })
}

export async function sendInvitationEmail(input: {
  acceptUrl: string
  inviterName: string
  organizationName: string
  to: string
}): Promise<void> {
  const { html, text } = await renderTemplate(
    InvitationEmail({
      acceptUrl: input.acceptUrl,
      inviterName: input.inviterName,
      organizationName: input.organizationName,
    })
  )

  await sendAuthEmail({
    html,
    subject: `Join ${input.organizationName} on Screenshot Studio`,
    text,
    to: input.to,
  })
}
