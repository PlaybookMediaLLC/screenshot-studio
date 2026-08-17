import 'server-only'

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'

const maxAttempts = 8
const staleProcessingMilliseconds = 10 * 60 * 1_000

type DrainPayload = {
  data: {
    action: string
    actor: { display: string | null; type: string; userId: string | null }
    entity: { id: string | null; type: string }
    metadata: unknown
    outcome: string
    organizationId: string
    requestId: string
  }
  id: string
  source: string
  specversion: '1.0'
  time: string
  type: string
}

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.AUDIT_DRAIN_ENCRYPTION_KEY
  const key = encodedKey ? Buffer.from(encodedKey, 'base64') : Buffer.alloc(0)
  if (key.length !== 32) {
    throw new Error('AUDIT_DRAIN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.')
  }

  return key
}

function getRetryTime(attemptCount: number): Date {
  const delayMilliseconds = Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1))
  return new Date(Date.now() + delayMilliseconds)
}

function getDeliveryHeaders(provider: string, secret: string, body: string): HeadersInit {
  const headers: HeadersInit = { 'content-type': 'application/cloudevents+json' }
  if (provider === 'SPLUNK') {
    return { ...headers, authorization: `Splunk ${secret}` }
  }
  if (provider === 'DATADOG') {
    return { ...headers, 'dd-api-key': secret }
  }

  return {
    ...headers,
    'x-screenshot-studio-signature': createHmac('sha256', secret).update(body).digest('hex'),
  }
}

function getDrainPayload(auditLog: {
  action: string
  actorDisplay: string | null
  actorType: string
  actorUserId: string | null
  createdAt: Date
  entityId: string | null
  entityType: string
  id: string
  metadata: unknown
  organizationId: string
  outcome: string
  requestId: string
}): DrainPayload {
  return {
    data: {
      action: auditLog.action,
      actor: {
        display: auditLog.actorDisplay,
        type: auditLog.actorType,
        userId: auditLog.actorUserId,
      },
      entity: { id: auditLog.entityId, type: auditLog.entityType },
      metadata: auditLog.metadata,
      outcome: auditLog.outcome,
      organizationId: auditLog.organizationId,
      requestId: auditLog.requestId,
    },
    id: auditLog.id,
    source: `screenshot-studio/organizations/${auditLog.organizationId}`,
    specversion: '1.0',
    time: auditLog.createdAt.toISOString(),
    type: `com.screenshot-studio.audit.${auditLog.action}`,
  }
}

function getEncryptedParts(value: string): [Buffer, Buffer, Buffer] {
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('Audit drain secret is invalid.')
  }

  return parts.map((part) => Buffer.from(part, 'base64url')) as [Buffer, Buffer, Buffer]
}

export function encryptDrainSecret(secret: string): string {
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [initializationVector, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.')
}

export function decryptDrainSecret(value: string): string {
  const [initializationVector, authTag, encrypted] = getEncryptedParts(value)
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), initializationVector)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

async function markDeliveryFailure(
  deliveryId: string,
  attemptCount: number,
  error: unknown
): Promise<void> {
  const exhausted = attemptCount >= maxAttempts
  await prisma.auditDrainDelivery.update({
    data: {
      lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown delivery error.',
      nextAttemptAt: getRetryTime(attemptCount),
      status: exhausted ? 'FAILED' : 'PENDING',
    },
    where: { id: deliveryId },
  })
}

async function deliverClaimedAuditDrain(deliveryId: string): Promise<void> {
  const delivery = await prisma.auditDrainDelivery.findUnique({
    include: { drain: true, outbox: { include: { auditLog: true } } },
    where: { id: deliveryId },
  })
  if (!delivery || !delivery.drain.enabled) {
    return
  }

  const body = JSON.stringify(getDrainPayload(delivery.outbox.auditLog))
  try {
    const response = await fetch(delivery.drain.endpoint, {
      body,
      headers: getDeliveryHeaders(
        delivery.drain.provider,
        decryptDrainSecret(delivery.drain.encryptedSigningSecret),
        body
      ),
      method: 'POST',
    })
    if (!response.ok) {
      throw new Error(`Drain responded with status ${response.status}.`)
    }
    await prisma.auditDrainDelivery.update({
      data: { deliveredAt: new Date(), responseCode: response.status, status: 'DELIVERED' },
      where: { id: delivery.id },
    })
  } catch (error) {
    await markDeliveryFailure(delivery.id, delivery.attemptCount, error)
  }
}

async function claimDelivery(deliveryId: string): Promise<boolean> {
  const result = await prisma.auditDrainDelivery.updateMany({
    data: { attemptCount: { increment: 1 }, status: 'PROCESSING' },
    where: { id: deliveryId, nextAttemptAt: { lte: new Date() }, status: 'PENDING' },
  })
  return result.count === 1
}

async function requeueStalledDeliveries(): Promise<void> {
  await prisma.auditDrainDelivery.updateMany({
    data: { status: 'PENDING' },
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: new Date(Date.now() - staleProcessingMilliseconds) },
    },
  })
}

export async function dispatchPendingAuditDrains(): Promise<number> {
  await requeueStalledDeliveries()
  const deliveries = await prisma.auditDrainDelivery.findMany({
    select: { id: true },
    take: 100,
    where: { nextAttemptAt: { lte: new Date() }, status: 'PENDING' },
  })
  for (const delivery of deliveries) {
    if (await claimDelivery(delivery.id)) {
      await deliverClaimedAuditDrain(delivery.id)
    }
  }

  return deliveries.length
}
