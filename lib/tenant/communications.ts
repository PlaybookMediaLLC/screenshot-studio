import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor, type TriggerServicePrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { getUnsubscribeHeaders, sendBulkEmail } from '@/lib/email'
import { ReleaseAnnouncementEmail } from '@/lib/email/templates/release-announcement'
import { getUnsubscribeUrl } from './unsubscribe-url'

/**
 * Release announcement delivery.
 *
 * Mirrors the scheduled-post publisher: claim the row with a conditional
 * update so concurrent workers cannot both send, record an attempt,
 * deliver, then resolve the attempt and write an audit entry.
 *
 * Delivery is exactly-once per recipient. Each address gets a
 * `CommunicationRecipient` row, and only rows without a `deliveredAt` are
 * sent to, so a retry after a partial failure reaches the remainder
 * without mailing anyone twice.
 */

const maxCommunicationAttempts = 3
const staleProcessingMilliseconds = 15 * 60 * 1000
const dispatchBatchSize = 25

function getTriggerPrincipal(
  organizationId: string,
  communicationId: string
): TriggerServicePrincipal {
  return { kind: 'trigger_service', organizationId, taskRunId: communicationId }
}

async function claimCommunication(id: string): Promise<boolean> {
  const claimed = await prisma.customerCommunication.updateMany({
    data: { status: 'PROCESSING' },
    where: {
      channel: 'EMAIL',
      id,
      scheduledFor: { lte: new Date() },
      status: 'SCHEDULED',
    },
  })
  return claimed.count === 1
}

/**
 * Return communications stuck in PROCESSING to the queue.
 *
 * A worker that died before recording an attempt made no provider call,
 * so requeueing is safe. Once an attempt exists the send may have
 * reached the provider, and re-sending would mail customers twice, so
 * those are failed for human review instead.
 */
async function recoverStaleCommunications(): Promise<void> {
  const staleBefore = new Date(Date.now() - staleProcessingMilliseconds)

  await prisma.customerCommunication.updateMany({
    data: { status: 'SCHEDULED' },
    where: {
      attempts: { none: {} },
      status: 'PROCESSING',
      updatedAt: { lt: staleBefore },
    },
  })

  const uncertain = await prisma.customerCommunication.findMany({
    select: { id: true, organizationId: true },
    take: 50,
    where: {
      attempts: { some: { completedAt: null } },
      status: 'PROCESSING',
      updatedAt: { lt: staleBefore },
    },
  })

  for (const communication of uncertain) {
    await prisma.$transaction(async (transaction) => {
      const failed = await transaction.customerCommunication.updateMany({
        data: { status: 'FAILED' },
        where: { id: communication.id, status: 'PROCESSING', updatedAt: { lt: staleBefore } },
      })
      if (failed.count === 0) return

      await transaction.communicationAttempt.updateMany({
        data: { completedAt: new Date(), failureCode: 'UNKNOWN_DELIVERY', outcome: 'FAILED' },
        where: { completedAt: null, customerCommunicationId: communication.id },
      })
      await appendAuditLog(transaction, {
        action: 'communication.delivery_recovery_required',
        actor: getAuditActor(getTriggerPrincipal(communication.organizationId, communication.id)),
        entityId: communication.id,
        entityType: 'customer_communication',
        metadata: { failureCode: 'UNKNOWN_DELIVERY' },
        organizationId: communication.organizationId,
        outcome: 'FAILED',
        requestId: communication.id,
      })
    })
  }
}

/**
 * Materialize the recipient list from current audience consent.
 *
 * Recipients are resolved at send time, not at scheduling time, so an
 * unsubscribe between scheduling and delivery is honored. Rows are
 * created with `skipDuplicates`, which makes re-running this safe.
 */
async function materializeRecipients(
  communicationId: string,
  organizationId: string
): Promise<void> {
  const subscribers = await prisma.audienceSubscriber.findMany({
    select: { email: true, id: true },
    where: { organizationId, suppressedAt: null, unsubscribedAt: null },
  })

  if (subscribers.length === 0) return

  await prisma.communicationRecipient.createMany({
    data: subscribers.map((subscriber) => ({
      customerCommunicationId: communicationId,
      email: subscriber.email,
      organizationId,
      subscriberId: subscriber.id,
    })),
    skipDuplicates: true,
  })
}

async function createAttempt(organizationId: string, customerCommunicationId: string) {
  return prisma.$transaction(async (transaction) => {
    const attemptNumber =
      (await transaction.communicationAttempt.count({ where: { customerCommunicationId } })) + 1
    return transaction.communicationAttempt.create({
      data: { attemptNumber, customerCommunicationId, organizationId },
    })
  })
}

async function loadCommunication(id: string) {
  return prisma.customerCommunication.findFirst({
    include: {
      organization: { select: { name: true } },
      releaseDocument: {
        include: { release: { select: { benefitStatement: true, title: true } } },
      },
    },
    where: { channel: 'EMAIL', id, status: 'PROCESSING' },
  })
}

type LoadedCommunication = NonNullable<Awaited<ReturnType<typeof loadCommunication>>>

/**
 * Deliver one claimed communication to every recipient not yet reached.
 */
async function deliverCommunication(communication: LoadedCommunication): Promise<number> {
  const { organizationId } = communication

  const pending = await prisma.communicationRecipient.findMany({
    select: { email: true, id: true },
    where: { customerCommunicationId: communication.id, deliveredAt: null },
  })

  if (pending.length === 0) {
    return 0
  }

  const attempt = await createAttempt(organizationId, communication.id)
  const release = communication.releaseDocument.release

  const result = await sendBulkEmail({
    recipients: pending.map((recipient) => {
      const unsubscribeUrl = getUnsubscribeUrl({ email: recipient.email, organizationId })
      return {
        email: recipient.email,
        headers: getUnsubscribeHeaders(unsubscribeUrl),
        template: ReleaseAnnouncementEmail({
          benefitStatement: release.benefitStatement,
          bodyMarkdown: communication.releaseDocument.bodyMarkdown,
          ctaUrl: communication.ctaUrl ?? undefined,
          postalAddress: process.env.COMPANY_POSTAL_ADDRESS,
          productName: communication.organization.name,
          title: release.title,
          unsubscribeUrl,
        }),
      }
    }),
    subject: release.title,
  })

  const deliveredAt = new Date()
  for (const recipient of pending) {
    const providerMessageId = result.delivered.get(recipient.email)
    if (providerMessageId === undefined) continue

    await prisma.communicationRecipient.update({
      data: { deliveredAt, providerMessageId },
      where: { id: recipient.id },
    })
  }

  for (const failure of result.failed) {
    await prisma.communicationRecipient.updateMany({
      data: { failureCode: failure.reason.slice(0, 200) },
      where: { customerCommunicationId: communication.id, email: failure.email },
    })
  }

  const delivered = result.delivered.size
  const everyRecipientReached = result.failed.length === 0

  await prisma.$transaction(async (transaction) => {
    await transaction.communicationAttempt.update({
      data: {
        completedAt: new Date(),
        outcome: everyRecipientReached ? 'SUCCEEDED' : 'FAILED',
        providerMessageId: null,
      },
      where: { id: attempt.id },
    })

    // Only a fully delivered send is DELIVERED. A partial send stays
    // retryable until the attempt ceiling, and the recipient rows ensure
    // the retry reaches only the addresses still missing.
    const exhausted = attempt.attemptNumber >= maxCommunicationAttempts
    await transaction.customerCommunication.update({
      data: {
        status: everyRecipientReached ? 'DELIVERED' : exhausted ? 'FAILED' : 'SCHEDULED',
      },
      where: { id: communication.id },
    })

    await appendAuditLog(transaction, {
      action: everyRecipientReached ? 'communication.delivered' : 'communication.partially_failed',
      actor: getAuditActor(getTriggerPrincipal(organizationId, communication.id)),
      entityId: communication.id,
      entityType: 'customer_communication',
      metadata: { attemptNumber: attempt.attemptNumber, delivered, failed: result.failed.length },
      organizationId,
      outcome: everyRecipientReached ? 'SUCCEEDED' : 'FAILED',
      requestId: communication.id,
    })
  })

  return delivered
}

/**
 * Dispatch every communication whose scheduled time has arrived.
 *
 * Called from the existing outbox cron, so a release announcement is
 * delivered by the same durable path as scheduled social posts.
 */
export async function dispatchDueCommunications(): Promise<number> {
  await recoverStaleCommunications()

  const due = await prisma.customerCommunication.findMany({
    select: { id: true, organizationId: true },
    orderBy: { scheduledFor: 'asc' },
    take: dispatchBatchSize,
    where: { channel: 'EMAIL', scheduledFor: { lte: new Date() }, status: 'SCHEDULED' },
  })

  let delivered = 0

  for (const candidate of due) {
    if (!(await claimCommunication(candidate.id))) continue

    const communication = await loadCommunication(candidate.id)
    if (!communication) continue

    try {
      await materializeRecipients(communication.id, communication.organizationId)
      delivered += await deliverCommunication(communication)
    } catch {
      // Leave the row in PROCESSING. Stale recovery decides whether it is
      // safe to requeue based on whether an attempt was recorded, which
      // is the only signal that a provider call may have happened.
    }
  }

  return delivered
}

/**
 * Record an explicit opt-out.
 *
 * Idempotent: unsubscribing twice keeps the original timestamp, so the
 * one-click endpoint can be retried by mail clients without churn.
 */
export async function unsubscribeAudienceMember(input: {
  email: string
  organizationId: string
}): Promise<boolean> {
  const updated = await prisma.audienceSubscriber.updateMany({
    data: { unsubscribedAt: new Date() },
    where: { email: input.email, organizationId: input.organizationId, unsubscribedAt: null },
  })

  if (updated.count > 0) {
    await appendAuditLog(prisma, {
      action: 'audience.unsubscribed',
      actor: getAuditActor(getTriggerPrincipal(input.organizationId, input.email)),
      entityId: input.email,
      entityType: 'audience_subscriber',
      organizationId: input.organizationId,
      requestId: input.email,
    })
  }

  // Report success even when nothing changed: the caller asked to be
  // unsubscribed and they are, which is what the endpoint must confirm.
  return true
}
