import { z } from 'zod'

/** Session-owned creation intent; callers retain the key when retrying. */
export const workspaceCreationInputSchema = z.strictObject({
  name: z.string().min(1),
  slug: z.string().min(1),
  idempotencyKey: z.uuid().optional(),
  keepCurrentActiveOrganization: z.boolean().optional(),
})

/** Input for the canonical atomic workspace creation service. */
export type WorkspaceCreationInput = z.infer<typeof workspaceCreationInputSchema>
