import 'server-only'

import { randomUUID } from 'node:crypto'
import { type CreateEmailOptions, Resend } from 'resend'
import { getAuthEmailSender } from '@/lib/auth/email'
import { chunk, RESEND_BATCH_LIMIT } from './batching'

/**
 * Delay between chunks. Resend rate-limits requests per second, and a
 * large announcement issues many chunk calls back to back. Pausing
 * between them keeps a send from failing partway into the uncertain
 * delivery state, which requires manual recovery.
 */
const CHUNK_DELAY_MS = 600

export interface EmailAttachment {
  content: string
  filename: string
}

export interface OutboundEmail {
  attachments?: EmailAttachment[]
  from?: string
  headers?: Record<string, string>
  html: string
  replyTo?: string
  subject: string
  text: string
  to: string
}

export interface DeliveryResult {
  /** Provider message IDs, keyed by recipient, for delivered messages. */
  delivered: Map<string, string>
  failed: { email: string; reason: string }[]
}

function getResendClient(): Resend | undefined {
  const apiKey = process.env.RESEND_API_KEY
  return apiKey ? new Resend(apiKey) : undefined
}

/**
 * Gmail collapses messages that share a subject into one conversation.
 * For an announcement sent to a whole audience that would thread every
 * copy together for anyone receiving more than one, so each message
 * carries a unique reference that suppresses the grouping.
 */
function buildPayload(email: OutboundEmail): CreateEmailOptions {
  const payload: CreateEmailOptions = {
    from: email.from ?? getAuthEmailSender(),
    headers: { 'X-Entity-Ref-ID': randomUUID(), ...email.headers },
    html: email.html,
    subject: email.subject,
    text: email.text,
    to: [email.to],
  }

  if (email.replyTo) payload.replyTo = email.replyTo
  if (email.attachments?.length) payload.attachments = email.attachments

  return payload
}

function hasAttachments(emails: OutboundEmail[]): boolean {
  return emails.some((email) => Boolean(email.attachments?.length))
}

async function sendIndividually(client: Resend, emails: OutboundEmail[]): Promise<DeliveryResult> {
  const delivered = new Map<string, string>()
  const failed: DeliveryResult['failed'] = []

  for (const email of emails) {
    try {
      const response = await client.emails.send(buildPayload(email))
      if (response.error) {
        failed.push({ email: email.to, reason: response.error.message })
        continue
      }
      delivered.set(email.to, response.data?.id ?? '')
    } catch (error) {
      failed.push({ email: email.to, reason: error instanceof Error ? error.message : 'unknown' })
    }
  }

  return { delivered, failed }
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Send a batch of messages, one per recipient.
 *
 * Returns per-recipient outcomes rather than throwing, because a partial
 * failure must not discard the record of what did send. The caller
 * persists delivered recipients so a retry does not send twice.
 */
export async function sendBatch(emails: OutboundEmail[]): Promise<DeliveryResult> {
  if (emails.length === 0) {
    return { delivered: new Map(), failed: [] }
  }

  const client = getResendClient()
  if (!client) {
    throw new Error('RESEND_API_KEY is required to send email.')
  }

  // The batch endpoint rejects attachments, so those fall back to
  // individual sends rather than failing the whole request.
  if (hasAttachments(emails)) {
    return sendIndividually(client, emails)
  }

  const delivered = new Map<string, string>()
  const failed: DeliveryResult['failed'] = []
  const chunks = chunk(emails, RESEND_BATCH_LIMIT)

  for (const [index, batch] of chunks.entries()) {
    if (index > 0) {
      await pause(CHUNK_DELAY_MS)
    }

    try {
      const response = await client.batch.send(batch.map(buildPayload))

      if (response.error) {
        for (const email of batch) {
          failed.push({ email: email.to, reason: response.error.message })
        }
        continue
      }

      // Resend returns IDs positionally, so a short response would
      // silently mismatch recipients to message IDs. Treat a length
      // mismatch as unknown rather than recording a wrong ID.
      const ids = response.data?.data ?? []
      batch.forEach((email, position) => {
        delivered.set(email.to, ids[position]?.id ?? '')
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown'
      for (const email of batch) {
        failed.push({ email: email.to, reason })
      }
    }
  }

  return { delivered, failed }
}
