import { z } from 'zod'

const emailWebhookSchema = z.string().url().optional()

type AuthEmail = {
  subject: string
  text: string
  to: string
}

function getEmailWebhookUrl(): string | undefined {
  return emailWebhookSchema.parse(process.env.AUTH_EMAIL_WEBHOOK_URL)
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const webhookUrl = getEmailWebhookUrl()
  if (!webhookUrl) {
    throw new Error('AUTH_EMAIL_WEBHOOK_URL is required to send authentication email.')
  }

  const response = await fetch(webhookUrl, {
    body: JSON.stringify(email),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Authentication email delivery failed with status ${response.status}.`)
  }
}
