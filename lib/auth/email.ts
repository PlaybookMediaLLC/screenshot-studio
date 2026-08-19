import { z } from 'zod'

/**
 * Outbound authentication email.
 *
 * Two transports are supported. Resend is used when `RESEND_API_KEY` is
 * present, since it is a first-class provider with delivery logs and a
 * verified sending domain. `AUTH_EMAIL_WEBHOOK_URL` remains supported so
 * self-hosted deployments can route mail through their own service
 * without depending on a specific vendor.
 *
 * Delivery failures throw. Better Auth runs these sends as background
 * tasks, so a thrown error surfaces in logs rather than blocking the
 * request, and a silent return would leave users waiting for a link that
 * was never sent.
 */

const emailWebhookSchema = z.string().url().optional()
const senderSchema = z.string().email().optional()

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_SENDER = 'Screenshot Studio <noreply@oppulence.app>'

type AuthEmail = {
  /**
   * Rendered HTML body. Optional so the webhook transport, which is
   * plaintext-only, keeps working for self-hosted deployments.
   */
  html?: string
  subject: string
  text: string
  to: string
}

function getEmailWebhookUrl(): string | undefined {
  return emailWebhookSchema.parse(process.env.AUTH_EMAIL_WEBHOOK_URL)
}

function getResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY || undefined
}

/**
 * The sender address must belong to a domain verified with the provider.
 * An unverified sender is rejected at send time, not at configuration
 * time, so this is worth getting right in one place.
 */
export function getAuthEmailSender(): string {
  const configured = process.env.AUTH_EMAIL_FROM
  if (!configured) {
    return DEFAULT_SENDER
  }

  // Accept either a bare address or a "Name <address>" header value.
  const bareAddress = configured.match(/<([^>]+)>/)?.[1] ?? configured
  senderSchema.parse(bareAddress)
  return configured
}

export function isAuthEmailConfigured(): boolean {
  return Boolean(getResendApiKey() || getEmailWebhookUrl())
}

async function sendViaResend(email: AuthEmail, apiKey: string): Promise<void> {
  const response = await fetch(RESEND_ENDPOINT, {
    body: JSON.stringify({
      from: getAuthEmailSender(),
      ...(email.html ? { html: email.html } : {}),
      subject: email.subject,
      text: email.text,
      to: [email.to],
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (!response.ok) {
    // Include the provider's reason: "domain not verified" and "invalid
    // sender" are the common failures and are indistinguishable without it.
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Resend rejected the authentication email with status ${response.status}. ${detail}`.trim()
    )
  }
}

async function sendViaWebhook(email: AuthEmail, webhookUrl: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    body: JSON.stringify(email),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Authentication email delivery failed with status ${response.status}.`)
  }
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const apiKey = getResendApiKey()
  if (apiKey) {
    return sendViaResend(email, apiKey)
  }

  const webhookUrl = getEmailWebhookUrl()
  if (webhookUrl) {
    return sendViaWebhook(email, webhookUrl)
  }

  throw new Error(
    'Authentication email is not configured. Set RESEND_API_KEY or AUTH_EMAIL_WEBHOOK_URL.'
  )
}
