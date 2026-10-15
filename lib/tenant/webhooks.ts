import 'server-only'

import { backendSDK, orNull, serviceBackend } from '@/lib/backend/sdk'
import type { WebhookPrincipal } from '@/lib/auth/principal'
import type { ReleaseCreateInput } from './schemas'
import {
  hasFreshWebhookTimestamp,
  verifyGitLabWebhookSignature,
  verifyWebhookSignature,
} from './webhook-security'

export {
  getWebhookReleaseInput,
  hasFreshWebhookTimestamp,
  verifyGitLabWebhookSignature,
  verifyWebhookSignature,
} from './webhook-security'

const secretReferenceSchema = /^[A-Z][A-Z0-9_]{0,127}$/

type WebhookSource = {
  id: string
  organizationId: string
  provider: string
  secretReference: string | null
}

type SourceReleaseInput = {
  eventId: string
  release: ReleaseCreateInput
  source: WebhookSource
}

function getWebhookSecret(source: WebhookSource): string | null {
  if (!source.secretReference || !secretReferenceSchema.test(source.secretReference)) {
    return null
  }

  return process.env[source.secretReference] ?? null
}

function getWebhookPrincipal(source: WebhookSource): WebhookPrincipal {
  return { connectionId: source.id, kind: 'webhook', organizationId: source.organizationId }
}

/** Resolves an active source app before its signature, and so its tenant, is known. */
export async function getWebhookSource(sourceAppId: string): Promise<WebhookSource | null> {
  return orNull(serviceBackend().getWebhookSource(sourceAppId))
}

export function verifyWebhookRequest(input: {
  body: string
  eventId: string | null
  signature: string | null
  source: WebhookSource
  timestamp: string | null
}): boolean {
  const secret = getWebhookSecret(input.source)
  if (!secret) {
    return false
  }

  if (input.source.provider === 'gitlab') {
    return verifyGitLabWebhookSignature({
      body: input.body,
      eventId: input.eventId,
      signature: input.signature,
      signingToken: secret,
      timestamp: input.timestamp,
    })
  }
  if (!verifyWebhookSignature(input.body, input.signature, secret)) {
    return false
  }

  return input.source.provider === 'github' || hasFreshWebhookTimestamp(input.timestamp)
}

/** Call only after verifyWebhookRequest: the backend trusts the webhook principal. */
export async function ingestSourceRelease(
  input: SourceReleaseInput
): Promise<{ created: boolean; releaseId: string }> {
  const { audience, benefitStatement, description, sourceUrls, title } = input.release
  return backendSDK({
    organizationId: input.source.organizationId,
    principal: getWebhookPrincipal(input.source),
    requestId: input.eventId,
  }).ingestSourceRelease({
    audience,
    benefitStatement,
    description,
    eventId: input.eventId,
    sourceAppId: input.source.id,
    sourceUrls,
    title,
  })
}
