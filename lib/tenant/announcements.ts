import 'server-only'

import type { BackendAnnouncement } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, withDates } from '@/lib/backend/sdk'
import type { AnnouncementScheduleInput, AudienceSubscriberCreateInput } from './schemas'

/**
 * Authoring surface for release announcements.
 *
 * Scheduling is separated from delivery: this module records intent, and
 * the backend maintenance job performs the send. That split keeps a slow
 * or failing provider from blocking the request that scheduled the
 * announcement, and it means a scheduled announcement survives a deploy
 * or restart.
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

function withScheduledFor<T extends Pick<BackendAnnouncement, 'scheduledFor'>>(announcement: T) {
  return {
    ...withDates(announcement),
    scheduledFor: announcement.scheduledFor ? new Date(announcement.scheduledFor) : null,
  }
}

export async function listAnnouncements(context: TenantContext, limit: number) {
  const { announcements } = await backendSDK(context).listAnnouncements(limit)
  return announcements.map(withScheduledFor)
}

/**
 * Estimate how many customers an announcement would reach right now.
 *
 * Advisory only. Recipients are resolved again at send time, so a member
 * who unsubscribes after this call is still excluded from delivery.
 */
export async function getAudienceReach(context: TenantContext): Promise<number> {
  return (await backendSDK(context).getAudienceReach()).reach
}

/**
 * Schedule an announcement for an approved release document.
 *
 * The backend refuses drafts, documents from another tenant, and an empty
 * audience, and returns the original announcement for a repeated
 * idempotency key.
 */
export async function scheduleAnnouncement(
  context: TenantContext,
  input: AnnouncementScheduleInput & { idempotencyKey: string }
) {
  const result = await backendSDK(context).scheduleAnnouncement(input)
  return { announcement: withScheduledFor(result.announcement), created: result.created }
}

/** Cancel a scheduled announcement; false when it is no longer `SCHEDULED`. */
export async function cancelAnnouncement(
  context: TenantContext,
  announcementId: string
): Promise<boolean> {
  return (await backendSDK(context).cancelAnnouncement(announcementId)).cancelled
}

/**
 * Add customers to the announcement audience. Existing rows, including
 * unsubscribed ones, are left untouched.
 */
export async function addAudienceSubscribers(
  context: TenantContext,
  input: AudienceSubscriberCreateInput
): Promise<{ added: number; skipped: number }> {
  return backendSDK(context).addAudienceSubscribers(input.subscribers)
}

export async function listAudienceSubscribers(
  context: TenantContext,
  options: { includeUnsubscribed: boolean; limit: number }
) {
  return withDates((await backendSDK(context).listAudienceSubscribers(options)).subscribers)
}
