import { z } from 'zod'

/** A safe membership snapshot returned by the canonical Go command. */
export const workspaceMemberSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  createdAt: z.iso.datetime(),
  role: z.enum([
    'owner',
    'admin',
    'creator',
    'approver',
    'publisher',
    'writer_publisher',
    'viewer',
  ]),
  user: z.object({
    id: z.string().min(1),
    email: z.string(),
    image: z.string().nullable(),
    name: z.string(),
  }),
})

/** Workspace members visible to an authorized administrator. */
export const workspaceMembersSchema = z.object({ members: z.array(workspaceMemberSchema) })
/** The removed member, captured in the same transaction as session revocation. */
export const workspaceMemberRemovalSchema = z.object({
  removed: z.literal(true),
  member: workspaceMemberSchema,
})
/** The departing member, captured in the same transaction as session revocation. */
export const workspaceMemberLeaveSchema = z.object({
  left: z.literal(true),
  member: workspaceMemberSchema,
})
/** Canonical membership metadata. */
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>
