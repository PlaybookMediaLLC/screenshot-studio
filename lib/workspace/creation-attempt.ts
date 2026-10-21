import { z } from 'zod'
import { workspaceCreateSchema } from './input-schemas'

/** Only a submitted creation intent survives closing or reloading this tab. */
export const workspaceCreationAttemptSchema = z.strictObject({
  version: z.literal(1),
  input: workspaceCreateSchema.extend({
    idempotencyKey: z.uuid(),
    keepCurrentActiveOrganization: z.literal(true),
  }),
})

/** Submitted request retained for safe reconciliation, without credentials. */
export type WorkspaceCreationAttempt = z.infer<typeof workspaceCreationAttemptSchema>

const recoverySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('empty') }),
  z.strictObject({ status: z.literal('pending'), attempt: workspaceCreationAttemptSchema }),
  z.strictObject({ status: z.literal('unavailable') }),
])

/** Make an independent intent; identical display names remain distinct. */
export function newWorkspaceCreationAttempt(name: string): WorkspaceCreationAttempt {
  const key = crypto.randomUUID()
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return workspaceCreationAttemptSchema.parse({
    version: 1,
    input: {
      name,
      slug: `${base || 'team'}-${key}`,
      idempotencyKey: key,
      keepCurrentActiveOrganization: true,
    },
  })
}

/** Tab-local, actor-scoped recovery key; unsubmitted form text is never saved. */
export function workspaceCreationStorageKey(userId: string): string {
  return `shots.workspace-creation.v1:${userId}`
}

const terminalCreationErrorSchema = z.object({
  data: z.object({ httpStatus: z.union([z.literal(400), z.literal(403), z.literal(409)]) }),
})

/** A definite rejection needs an explicit discard, while uncertain outcomes retain retries. */
export function isTerminalCreationError(error: unknown): boolean {
  return terminalCreationErrorSchema.safeParse(error).success
}

/** Invalid or outdated stored input must never become a new creation request. */
export function readWorkspaceCreationAttempt(userId: string): z.infer<typeof recoverySchema> {
  try {
    const raw = sessionStorage.getItem(workspaceCreationStorageKey(userId))
    if (!raw) return recoverySchema.parse({ status: 'empty' })
    if (raw.length > 4096) return recoverySchema.parse({ status: 'unavailable' })
    const parsed = workspaceCreationAttemptSchema.safeParse(JSON.parse(raw))
    return recoverySchema.parse(
      parsed.success ? { status: 'pending', attempt: parsed.data } : { status: 'unavailable' }
    )
  } catch {
    return recoverySchema.parse({ status: 'unavailable' })
  }
}
