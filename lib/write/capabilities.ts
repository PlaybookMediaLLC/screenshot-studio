import { z } from 'zod'
import { AUTO_DM_UNAVAILABLE } from '@/lib/write/automation'
import type { DraftChannel, DraftKind, PostPoll } from '@/lib/write/document'

/**
 * What each platform can publish (RFC 042), one typed entry per platform.
 * Every capability here is backed by the provider's documentation and the
 * adapter that sends it; the matrix in
 * docs/scheduling/typefully/write/implementation-matrix.md links the sources.
 * Go holds the same numbers (`draftChannelLimits`, `checkDraftExtras`).
 */

/** Media a post can carry. */
export const mediaKindSchema = z.enum(['image', 'gif', 'video', 'pdf'])

/** One of {@link mediaKindSchema}. */
export type MediaKind = z.infer<typeof mediaKindSchema>

/** Whether a capability is live, or why it is not. */
export const availabilitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    /** What the person can do about it, when anything. */
    action: z.enum(['connect', 'reconnect', 'upgrade-account', 'none']),
    reason: z.string(),
  }),
])

/** One of {@link availabilitySchema}. */
export type Availability = z.infer<typeof availabilitySchema>

const AVAILABLE: Availability = { available: true }

/** A platform's poll rules: how many options, how long, which fields. */
export type PollRules = {
  durationsMinutes: readonly number[]
  maxOptionLength: number
  maxOptions: number
  minOptions: number
  /** LinkedIn asks its own question; X uses the post's text. */
  question: 'field' | 'post-text'
  questionLimit: number
  /** Polls and media never go together on these platforms. */
  withMedia: false
}

/** What one platform can publish. */
export type PlatformCapabilities = {
  /** The caption limit for a standard account. */
  captionLimit: number
  /** The caption limit for an account the platform marks Premium, when it has one. */
  premiumCaptionLimit: number | null
  /** Draft kinds this platform takes. */
  kinds: readonly DraftKind[]
  label: string
  /** Media types and how many images one post carries. */
  media: { imageLimit: number; kinds: readonly MediaKind[]; videoAlone: boolean }
  /** Mentions: how they are written and whether a lookup backs them. */
  mentions: 'handle' | 'annotation' | 'none'
  poll: PollRules | null
  /** Post-level settings the adapter sends. */
  settings: {
    community: boolean
    disclosures: boolean
    firstComment: boolean
    pdfDocument: boolean
    replySettings: boolean
    visibility: boolean
  }
  /** Threads: posts after the first go out as replies, up to this many posts. */
  thread: { maxPosts: number } | null
  /** Follow-ups once live: reposts at set times, a plug reply, direct messages. */
  automation: { directMessage: Availability; plug: Availability; retweet: Availability }
}

/** Follow-ups a platform does not have. */
const NO_AUTOMATION: PlatformCapabilities['automation'] = {
  directMessage: { action: 'none', available: false, reason: 'Follow-ups are for X posts.' },
  plug: { action: 'none', available: false, reason: 'Follow-ups are for X posts.' },
  retweet: { action: 'none', available: false, reason: 'Follow-ups are for X posts.' },
}

const MINUTES = { day: 1_440, hour: 60 }

/** X: threads, replies, quotes, polls, communities and disclosures (X API v2 `POST /2/tweets`). */
const X: PlatformCapabilities = {
  captionLimit: 280,
  kinds: ['standard', 'reply', 'quote', 'repurpose', 'article'],
  label: 'X',
  media: { imageLimit: 4, kinds: ['image', 'gif', 'video'], videoAlone: true },
  mentions: 'handle',
  poll: {
    durationsMinutes: [
      5,
      30,
      MINUTES.hour,
      6 * MINUTES.hour,
      MINUTES.day,
      3 * MINUTES.day,
      7 * MINUTES.day,
    ],
    maxOptionLength: 25,
    maxOptions: 4,
    minOptions: 2,
    question: 'post-text',
    questionLimit: 280,
    withMedia: false,
  },
  premiumCaptionLimit: 25_000,
  settings: {
    community: true,
    disclosures: true,
    firstComment: false,
    pdfDocument: false,
    replySettings: true,
    visibility: false,
  },
  thread: { maxPosts: 25 },
  automation: {
    directMessage: { action: 'none', available: false, reason: AUTO_DM_UNAVAILABLE },
    plug: AVAILABLE,
    retweet: AVAILABLE,
  },
}

/** LinkedIn: one post, polls, PDF documents and organization mentions (Posts API). */
const LINKEDIN: PlatformCapabilities = {
  captionLimit: 3_000,
  kinds: ['standard', 'quote', 'repurpose'],
  label: 'LinkedIn',
  media: { imageLimit: 9, kinds: ['image', 'gif', 'video', 'pdf'], videoAlone: true },
  mentions: 'annotation',
  poll: {
    durationsMinutes: [MINUTES.day, 3 * MINUTES.day, 7 * MINUTES.day, 14 * MINUTES.day],
    maxOptionLength: 30,
    maxOptions: 4,
    minOptions: 2,
    question: 'field',
    questionLimit: 140,
    withMedia: false,
  },
  premiumCaptionLimit: null,
  settings: {
    community: false,
    disclosures: false,
    firstComment: true,
    pdfDocument: true,
    replySettings: false,
    visibility: true,
  },
  thread: null,
  automation: NO_AUTOMATION,
}

function simple(
  label: string,
  captionLimit: number,
  imageLimit: number,
  thread: boolean
): PlatformCapabilities {
  return {
    captionLimit,
    kinds: ['standard', 'repurpose'],
    label,
    media: { imageLimit, kinds: ['image', 'gif', 'video'], videoAlone: true },
    mentions: 'handle',
    poll: null,
    premiumCaptionLimit: null,
    settings: {
      community: false,
      disclosures: false,
      firstComment: false,
      pdfDocument: false,
      replySettings: false,
      visibility: false,
    },
    thread: thread ? { maxPosts: 25 } : null,
    automation: NO_AUTOMATION,
  }
}

/** Every platform's capabilities. */
export const CAPABILITIES: Record<DraftChannel, PlatformCapabilities> = {
  bluesky: simple('Bluesky', 300, 4, true),
  instagram: { ...simple('Instagram', 2_200, 10, false), mentions: 'handle' },
  linkedin: LINKEDIN,
  mastodon: simple('Mastodon', 500, 4, true),
  threads: simple('Threads', 500, 10, true),
  x: X,
}

/** An account's own standing on its platform, as the platform reports it. */
export type AccountStanding = {
  /** X Premium, read from X; never the workspace's plan. Unknown is standard. */
  premium: boolean
}

/** The caption limit for one account: Premium only when the platform says so. */
export function captionLimit(channel: DraftChannel, account?: AccountStanding): number {
  const capabilities = CAPABILITIES[channel]
  return account?.premium && capabilities.premiumCaptionLimit
    ? capabilities.premiumCaptionLimit
    : capabilities.captionLimit
}

/** Whether a platform takes a kind of draft, and why not. */
export function kindAvailability(
  channel: DraftChannel,
  kind: DraftKind,
  account?: AccountStanding
): Availability {
  if (!CAPABILITIES[channel].kinds.includes(kind)) {
    return {
      action: 'none',
      available: false,
      reason: `${CAPABILITIES[channel].label} does not take ${kind} drafts.`,
    }
  }
  if (kind === 'article' && !account?.premium) {
    return {
      action: 'upgrade-account',
      available: false,
      reason:
        'X publishes articles only from X Premium accounts. This account is not Premium on X.',
    }
  }
  return AVAILABLE
}

/**
 * The problems with a poll on a platform, each a sentence. X uses the post's
 * text as the question; LinkedIn needs its own.
 */
export function pollProblems(channel: DraftChannel, poll: PostPoll, mediaCount: number): string[] {
  const rules = CAPABILITIES[channel].poll
  if (!rules) return [`${CAPABILITIES[channel].label} posts cannot carry a poll.`]
  const problems: string[] = []
  const options = poll.options.map((option) => option.trim())
  if (rules.question === 'field') {
    const question = poll.question?.trim() ?? ''
    if (!question) problems.push('Ask the poll question.')
    else if ([...question].length > rules.questionLimit)
      problems.push(`Keep the question to ${rules.questionLimit} characters.`)
  }
  if (options.length < rules.minOptions || options.length > rules.maxOptions) {
    problems.push(`A poll has ${rules.minOptions} to ${rules.maxOptions} options.`)
  }
  if (options.some((option) => !option)) problems.push('Fill in every option.')
  if (options.some((option) => [...option].length > rules.maxOptionLength)) {
    problems.push(`Keep each option to ${rules.maxOptionLength} characters.`)
  }
  if (!rules.durationsMinutes.includes(poll.durationMinutes)) {
    problems.push(`Pick one of ${CAPABILITIES[channel].label}'s poll lengths.`)
  }
  if (mediaCount > 0 && !rules.withMedia) {
    problems.push(`${CAPABILITIES[channel].label} posts with a poll cannot have media.`)
  }
  return problems
}
