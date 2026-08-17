import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { releaseCreateSchema, type ReleaseCreateInput } from './schemas'

const webhookMaxAgeMilliseconds = 5 * 60 * 1_000

const githubReleaseSchema = z.object({
  release: z.object({
    body: z.string().trim().max(10_000).optional(),
    name: z.string().trim().max(160).optional(),
    tag_name: z.string().trim().max(160).optional(),
  }),
})

const gitlabReleaseSchema = z.object({
  description: z.string().trim().max(10_000).optional(),
  name: z.string().trim().max(160).optional(),
  tag: z.string().trim().max(160).optional(),
})

function hasFreshTimestamp(timestamp: number): boolean {
  return Math.abs(Date.now() - timestamp) <= webhookMaxAgeMilliseconds
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function hasFreshWebhookTimestamp(value: string | null): boolean {
  if (!value) {
    return false
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && hasFreshTimestamp(timestamp)
}

export function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature?.startsWith('sha256=')) {
    return false
  }

  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  return secureEqual(signature, expected)
}

export function verifyGitLabWebhookSignature(input: {
  body: string
  eventId: string | null
  signature: string | null
  signingToken: string
  timestamp: string | null
}): boolean {
  if (
    !input.eventId ||
    !input.signature ||
    !input.timestamp ||
    !input.signingToken.startsWith('whsec_')
  ) {
    return false
  }

  const seconds = Number(input.timestamp)
  if (!Number.isSafeInteger(seconds) || !hasFreshTimestamp(seconds * 1_000)) {
    return false
  }

  const secret = Buffer.from(input.signingToken.slice('whsec_'.length), 'base64')
  const message = `${input.eventId}.${input.timestamp}.${input.body}`
  const expected = `v1,${createHmac('sha256', secret).update(message).digest('base64')}`
  return input.signature.split(' ').some((signature) => secureEqual(signature, expected))
}

export function getWebhookReleaseInput(
  provider: string,
  eventName: string | null,
  body: string
): ReleaseCreateInput {
  const payload = JSON.parse(body) as unknown
  if (provider === 'gitlab' && eventName === 'Release Hook') {
    const release = gitlabReleaseSchema.parse(payload)
    return releaseCreateSchema.parse({
      benefitStatement: release.description || release.tag || release.name,
      title: release.name || release.tag,
    })
  }
  if (provider !== 'github' || eventName !== 'release') {
    return releaseCreateSchema.parse(payload)
  }

  const release = githubReleaseSchema.parse(payload).release
  return releaseCreateSchema.parse({
    benefitStatement: release.body || release.tag_name || release.name,
    title: release.name || release.tag_name,
  })
}
