import 'server-only'

import { generateText } from 'ai'
import type { OrganizationAccess } from '@/lib/auth/access'
import { withAiCredits } from '@/lib/ai/metering'
import { models } from '@/lib/ai/models'
import { DRAFT_CHANNEL_LIMITS, type DraftChannel } from '@/lib/content-drafts/serialize'

/**
 * AI help in the composer (RFC 037): rewrite a draft for a channel, turn it
 * into a thread, or shorten it to fit. The model answers posts separated by a
 * line holding only `---`, which become the thread's posts. Charged to the
 * workspace's AI credits like the editor's other AI calls.
 */

/** What the composer asks the AI to do. */
export type DraftAssistAction = 'rewrite' | 'thread' | 'shorten'

const CHANNEL_NAMES: Record<DraftChannel, string> = {
  bluesky: 'Bluesky',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  mastodon: 'Mastodon',
  threads: 'Threads',
  x: 'X',
}

function instructions(action: DraftAssistAction, channel: DraftChannel): string {
  const limit = DRAFT_CHANNEL_LIMITS[channel]
  const name = CHANNEL_NAMES[channel]
  const shape = `Answer with the post text only. Separate posts with a line holding only ---. Each post is at most ${limit} characters. Keep the writer's facts, names and links exactly; add none.`
  switch (action) {
    case 'rewrite':
      return `Rewrite this social post for ${name}: the voice and length that work there, the same meaning. Keep a thread a thread. ${shape}`
    case 'thread':
      return `Turn this into a ${name} thread: a first post that makes people read on, then posts that each carry one point. ${shape}`
    case 'shorten':
      return `Shorten each post so it fits ${name}, cutting words rather than meaning. Keep the same number of posts. ${shape}`
  }
}

/** The AI's version of the draft's posts. */
export function assistDraft(
  access: OrganizationAccess,
  input: { action: DraftAssistAction; channel: DraftChannel; posts: string[] }
): Promise<{ posts: string[] }> {
  return withAiCredits(access, async () => {
    const { text } = await generateText({
      model: models.languageModel('fast'),
      prompt: input.posts.join('\n---\n'),
      system: instructions(input.action, input.channel),
    })
    const posts = text
      .split(/\n\s*---\s*\n/)
      .map((post) => post.trim())
      .filter(Boolean)
    return { posts: posts.length > 0 ? posts : input.posts }
  })
}
