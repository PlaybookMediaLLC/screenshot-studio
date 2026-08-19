import 'server-only'

import type { ReactElement } from 'react'
import { renderTemplate } from './render'
import { type DeliveryResult, type OutboundEmail, sendBatch } from './transport'

export type { DeliveryResult, OutboundEmail }

export interface SendEmailInput {
  from?: string
  headers?: Record<string, string>
  replyTo?: string
  subject: string
  template: ReactElement
  to: string
}

export interface BulkRecipient {
  email: string
  /**
   * Per-recipient template. Commercial mail carries a signed,
   * address-specific unsubscribe link, so recipients cannot share one
   * rendered body.
   */
  template: ReactElement
  headers?: Record<string, string>
}

export interface SendBulkInput {
  from?: string
  recipients: BulkRecipient[]
  subject: string
}

/**
 * Send one message rendered from a template.
 *
 * Throws on failure so callers that must know about delivery, such as an
 * invitation flow, can surface the error. Bulk sending deliberately does
 * not throw.
 */
export async function sendEmail(input: SendEmailInput): Promise<string> {
  const { html, text } = await renderTemplate(input.template)

  const result = await sendBatch([
    {
      from: input.from,
      headers: input.headers,
      html,
      replyTo: input.replyTo,
      subject: input.subject,
      text,
      to: input.to,
    },
  ])

  const failure = result.failed[0]
  if (failure) {
    throw new Error(`Email delivery to ${failure.email} failed: ${failure.reason}`)
  }

  return result.delivered.get(input.to) ?? ''
}

/**
 * Send a rendered message to many recipients.
 *
 * Returns per-recipient outcomes instead of throwing. A partial failure
 * must not discard the record of what already went out, otherwise a retry
 * would send duplicates to recipients who were already reached.
 */
export async function sendBulkEmail(input: SendBulkInput): Promise<DeliveryResult> {
  if (input.recipients.length === 0) {
    return { delivered: new Map(), failed: [] }
  }

  const emails = await Promise.all(
    input.recipients.map(async (recipient): Promise<OutboundEmail> => {
      const { html, text } = await renderTemplate(recipient.template)
      return {
        from: input.from,
        headers: recipient.headers,
        html,
        subject: input.subject,
        text,
        to: recipient.email,
      }
    })
  )

  return sendBatch(emails)
}

/**
 * `List-Unsubscribe` headers for commercial mail.
 *
 * Gmail and Yahoo require one-click unsubscribe from bulk senders.
 * `List-Unsubscribe-Post` is what makes it one-click: without it, clients
 * fall back to opening the URL, and some treat its absence as a
 * deliverability signal.
 */
export function getUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
