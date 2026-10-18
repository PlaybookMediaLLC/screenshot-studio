import { z } from 'zod'

/**
 * A draft's comment threads, as stored with it (RFC 037). The editor keeps
 * them as plugin options with Date fields; the API carries JSON. Threads from
 * two editors are merged by id, so a live session never drops a peer's thread.
 */

const commentSchema = z.looseObject({
  createdAt: z.coerce.date(),
  id: z.string(),
  userId: z.string(),
})

const threadSchema = z.looseObject({
  comments: z.array(commentSchema).default([]),
  createdAt: z.coerce.date(),
  id: z.string(),
  isResolved: z.boolean().default(false),
  userId: z.string(),
})

const userSchema = z.looseObject({ id: z.string(), name: z.string() })

/** The stored shape: threads and the people who wrote them. */
export const draftDiscussionsSchema = z.object({
  threads: z.array(threadSchema).default([]),
  users: z.record(z.string(), userSchema).default({}),
})

/** One of {@link draftDiscussionsSchema}, with dates as Dates. */
export type DraftDiscussions = z.output<typeof draftDiscussionsSchema>

/** Stored threads ready for the editor; anything unreadable is dropped. */
export function readDiscussions(raw: unknown): DraftDiscussions {
  const parsed = z
    .object({
      threads: z.array(z.unknown()).default([]),
      users: z.record(z.string(), z.unknown()).default({}),
    })
    .safeParse(raw ?? {})
  if (!parsed.success) return { threads: [], users: {} }
  return {
    threads: parsed.data.threads.flatMap((thread) => {
      const result = threadSchema.safeParse(thread)
      return result.success ? [result.data] : []
    }),
    users: Object.fromEntries(
      Object.entries(parsed.data.users).flatMap(([id, user]) => {
        const result = userSchema.safeParse(user)
        return result.success ? [[id, result.data]] : []
      })
    ),
  }
}

/** Both sides' threads by id, ours winning where both have one. */
export function mergeDiscussions(
  ours: DraftDiscussions,
  theirs: DraftDiscussions
): DraftDiscussions {
  const threads = new Map(theirs.threads.map((thread) => [thread.id, thread]))
  for (const thread of ours.threads) threads.set(thread.id, thread)
  return { threads: [...threads.values()], users: { ...theirs.users, ...ours.users } }
}
