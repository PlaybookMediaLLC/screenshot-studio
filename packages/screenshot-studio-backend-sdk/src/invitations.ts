import { z } from 'zod'
import { workspaceCreationMemberSchema } from './workspace-creation.ts'

/** Canonical persisted invitation state. The ID is an opaque, single-use link. */
export const invitationRecordSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  inviterId: z.string().min(1),
  email: z.string(),
  role: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'rejected', 'canceled', 'expired']),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
})

/** Administrator result, including the existing invitation mail metadata. */
export const workspaceInvitationDetailSchema = invitationRecordSchema.extend({
  organization: z.object({ name: z.string() }),
  user: z.object({ email: z.string(), name: z.string() }),
})

/** Recipient-only metadata used to explain a link before granting membership. */
export const recipientInvitationSchema = invitationRecordSchema.extend({
  organizationName: z.string(),
  organizationSlug: z.string(),
  inviterEmail: z.string(),
})

/** The invitation and membership committed in the same transaction. */
export const invitationResponseSchema = z.object({
  invitation: recipientInvitationSchema,
  member: workspaceCreationMemberSchema.nullable(),
})

/** Safe recipient-visible invitation state. */
export type RecipientInvitation = z.infer<typeof recipientInvitationSchema>
/** Canonical administrator invitation result. */
export type WorkspaceInvitationDetail = z.infer<typeof workspaceInvitationDetailSchema>
