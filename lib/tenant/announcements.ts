import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import type { OrganizationAccess } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type { AnnouncementScheduleInput, AudienceSubscriberCreateInput } from './schemas'

/**
 * Authoring surface for release announcements.
 *
 * Scheduling is separated from delivery: this module records intent, and
 * `communications.ts` performs the send from the dispatch cron. That
 * split keeps a slow or failing provider from blocking the request that
 * scheduled the announcement, and it means a scheduled announcement
 * survives a deploy or restart.
 */

export class AnnouncementError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'AnnouncementError'
  }
}

const announcementSelect = {
  channel: true,
  createdAt: true,
  ctaUrl: true,
  id: true,
  scheduledFor: true,
  status: true,
} as const

export async function listAnnouncements(organizationId: string, limit: number) {
  const announcements = await prisma.customerCommunication.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      ...announcementSelect,
      _count: { select: { recipients: true } },
      releaseDocument: {
        select: { release: { select: { id: true, title: true } }, revision: true },
      },
    },
    take: limit,
    where: { channel: 'EMAIL', organizationId },
  })

  return announcements
}

/**
 * Estimate how many customers an announcement would reach right now.
 *
 * Advisory only. Recipients are resolved again at send time, so a member
 * who unsubscribes after this call is still excluded from delivery.
 */
export async function getAudienceReach(organizationId: string): Promise<number> {
  return prisma.audienceSubscriber.count({
    where: { organizationId, suppressedAt: null, unsubscribedAt: null },
  })
}

/**
 * Schedule an announcement for an approved release document.
 *
 * Only approved documents may be announced: an announcement is the
 * irreversible step in the workflow, and sending a draft to customers
 * cannot be undone. The document is looked up scoped to the caller's
 * organization, so an ID from another tenant reads as not found.
 */
export async function scheduleAnnouncement(
  access: OrganizationAccess,
  input: AnnouncementScheduleInput & { idempotencyKey: string }
) {
  const { organizationId } = access

  const document = await prisma.releaseDocument.findFirst({
    select: { id: true, releaseId: true, status: true },
    where: { id: input.releaseDocumentId, organizationId },
  })

  if (!document) {
    throw new AnnouncementError('Release document not found.', 404)
  }

  if (document.status !== 'APPROVED') {
    throw new AnnouncementError(
      'Only an approved release document can be announced to customers.',
      409
    )
  }

  // Reaching nobody is almost always a mistake in setup rather than an
  // intent to send to an empty audience, so it fails loudly here instead
  // of succeeding silently at dispatch time.
  if ((await getAudienceReach(organizationId)) === 0) {
    throw new AnnouncementError(
      'This organization has no subscribed customers to announce to.',
      409
    )
  }

  const existing = await prisma.customerCommunication.findUnique({
    select: announcementSelect,
    where: {
      organizationId_idempotencyKey: { idempotencyKey: input.idempotencyKey, organizationId },
    },
  })
  if (existing) {
    return { announcement: existing, created: false }
  }

  const scheduledFor = input.scheduledFor ?? new Date()

  const announcement = await prisma.$transaction(async (transaction) => {
    const created = await transaction.customerCommunication.create({
      data: {
        channel: 'EMAIL',
        ctaUrl: input.ctaUrl,
        idempotencyKey: input.idempotencyKey,
        organizationId,
        releaseDocumentId: document.id,
        scheduledFor,
        status: 'SCHEDULED',
      },
      select: announcementSelect,
    })

    await appendAuditLog(transaction, {
      action: 'communication.scheduled',
      actor: getAuditActor(access.principal),
      entityId: created.id,
      entityType: 'customer_communication',
      metadata: { releaseId: document.releaseId, scheduledFor: scheduledFor.toISOString() },
      organizationId,
      requestId: input.idempotencyKey,
    })

    return created
  })

  return { announcement, created: true }
}

/**
 * Cancel a scheduled announcement.
 *
 * Only a `SCHEDULED` announcement can be cancelled. Once dispatch claims
 * it the messages may already be with the provider, and cancelling then
 * would report a stop that did not happen.
 */
export async function cancelAnnouncement(
  access: OrganizationAccess,
  announcementId: string
): Promise<boolean> {
  const { organizationId } = access

  return prisma.$transaction(async (transaction) => {
    const cancelled = await transaction.customerCommunication.updateMany({
      data: { status: 'CANCELLED' },
      where: { id: announcementId, organizationId, status: 'SCHEDULED' },
    })

    if (cancelled.count === 0) {
      return false
    }

    await appendAuditLog(transaction, {
      action: 'communication.cancelled',
      actor: getAuditActor(access.principal),
      entityId: announcementId,
      entityType: 'customer_communication',
      organizationId,
      requestId: announcementId,
    })

    return true
  })
}

/**
 * Add customers to the announcement audience.
 *
 * Existing rows are left untouched rather than reset. Re-importing a list
 * must not resurrect consent for someone who unsubscribed, which is what
 * an upsert that cleared `unsubscribedAt` would do.
 */
export async function addAudienceSubscribers(
  access: OrganizationAccess,
  input: AudienceSubscriberCreateInput
): Promise<{ added: number; skipped: number }> {
  const { organizationId } = access

  const unique = new Map(input.subscribers.map((subscriber) => [subscriber.email, subscriber]))

  const result = await prisma.audienceSubscriber.createMany({
    data: [...unique.values()].map((subscriber) => ({
      email: subscriber.email,
      name: subscriber.name,
      organizationId,
    })),
    skipDuplicates: true,
  })

  return { added: result.count, skipped: unique.size - result.count }
}

export async function listAudienceSubscribers(
  organizationId: string,
  options: { includeUnsubscribed: boolean; limit: number }
) {
  return prisma.audienceSubscriber.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      email: true,
      id: true,
      name: true,
      suppressedAt: true,
      unsubscribedAt: true,
    },
    take: options.limit,
    where: {
      organizationId,
      ...(options.includeUnsubscribed ? {} : { suppressedAt: null, unsubscribedAt: null }),
    },
  })
}
