import 'server-only'

import { randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor, type WebhookPrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
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

async function getIngestedRelease(
  transaction: Prisma.TransactionClient,
  input: SourceReleaseInput,
  idempotencyKey: string
): Promise<string | null> {
  const event = await transaction.outboxEvent.findUnique({
    where: {
      organizationId_idempotencyKey: {
        idempotencyKey,
        organizationId: input.source.organizationId,
      },
    },
  })
  return event?.aggregateId ?? null
}

async function createIngestOutbox(
  transaction: Prisma.TransactionClient,
  input: SourceReleaseInput,
  idempotencyKey: string,
  releaseId: string
): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      aggregateId: releaseId,
      aggregateType: 'release',
      idempotencyKey,
      organizationId: input.source.organizationId,
      payload: { releaseId, sourceAppId: input.source.id },
      type: 'release.ingested',
    },
  })
}

async function createIngestedRelease(
  transaction: Prisma.TransactionClient,
  input: SourceReleaseInput,
  releaseId: string
): Promise<void> {
  await transaction.release.create({
    data: {
      benefitStatement: input.release.benefitStatement,
      id: releaseId,
      organizationId: input.source.organizationId,
      title: input.release.title,
    },
  })
}

async function auditReleaseIngest(
  transaction: Prisma.TransactionClient,
  input: SourceReleaseInput,
  releaseId: string
): Promise<void> {
  await appendAuditLog(transaction, {
    action: 'product.release_ingested',
    actor: getAuditActor(getWebhookPrincipal(input.source)),
    entityId: releaseId,
    entityType: 'release',
    organizationId: input.source.organizationId,
    requestId: input.eventId,
  })
}

export async function getWebhookSource(sourceAppId: string): Promise<WebhookSource | null> {
  return prisma.sourceApp.findFirst({
    select: { id: true, organizationId: true, provider: true, secretReference: true },
    where: { id: sourceAppId, status: 'ACTIVE' },
  })
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

export async function ingestSourceRelease(
  input: SourceReleaseInput
): Promise<{ created: boolean; releaseId: string }> {
  const idempotencyKey = `source:${input.source.id}:${input.eventId}`
  const releaseId = randomUUID()
  return prisma.$transaction(async (transaction) => {
    const existingReleaseId = await getIngestedRelease(transaction, input, idempotencyKey)
    if (existingReleaseId) {
      return { created: false, releaseId: existingReleaseId }
    }

    await createIngestOutbox(transaction, input, idempotencyKey, releaseId)
    await createIngestedRelease(transaction, input, releaseId)
    await auditReleaseIngest(transaction, input, releaseId)
    return { created: true, releaseId }
  })
}
