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
  durationRange?: { min: number; max: number }
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
  bluesky: { ...simple('Bluesky', 300, 4, true), kinds: ['standard', 'repurpose', 'quote'] },
  instagram: { ...simple('Instagram', 2_200, 10, false), mentions: 'handle' },
  linkedin: LINKEDIN,
  mastodon: { ...simple('Mastodon', 500, 4, true), kinds: ['standard', 'repurpose', 'quote'] },
  threads: {
    ...simple('Threads', 500, 10, true),
    poll: {
      durationsMinutes: [0],
      minOptions: 2,
      maxOptions: 4,
      maxOptionLength: 25,
      question: 'post-text',
      questionLimit: 500,
      withMedia: false,
    },
  },
  x: X,
}

/** Publishing capabilities verified for the connected account. */
export const accountStandingSchema = z.object({
  nativeQuotes: z.boolean().optional(),
  pollLimits: z
    .object({
      max_options: z.number().int().min(2),
      max_characters_per_option: z.number().int().positive(),
      min_expiration: z.number().int().positive(),
      max_expiration: z.number().int().positive(),
    })
    .nullish(),
  maxWeightedCharacters: z.union([z.literal(280), z.literal(25_000)]).nullish(),
  articles: z.boolean().nullish(),
})

/** One verified account's capabilities; absent fields remain unknown. */
export type AccountStanding = z.infer<typeof accountStandingSchema>

/** The caption limit for one account, independent of an editable Premium label. */
export function captionLimit(channel: DraftChannel, account?: AccountStanding): number {
  const capabilities = CAPABILITIES[channel]
  return channel === 'x' && account?.maxWeightedCharacters
    ? account.maxWeightedCharacters
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
  if (channel === 'mastodon' && kind === 'quote' && !account?.nativeQuotes)
    return {
      action: 'reconnect',
      available: false,
      reason: 'Reconnect Mastodon on a server with native quote support and grant search access.',
    }
  if (channel === 'x' && kind === 'quote') {
    return {
      action: 'none',
      available: false,
      reason:
        'X quote posts require Enterprise API access, which this connection has not verified.',
    }
  }
  if (kind === 'article' && account?.articles !== true) {
    return {
      action: account?.articles === false ? 'upgrade-account' : 'reconnect',
      available: false,
      reason:
        account?.articles === false
          ? 'This X account does not have verified Articles access. Connect an eligible account.'
          : 'Reconnect X to check this account’s Articles access.',
    }
  }
  return AVAILABLE
}

/**
 * The problems with a poll on a platform, each a sentence. X uses the post's
 * text as the question; LinkedIn needs its own.
 */
export function pollProblems(
  channel: DraftChannel,
  poll: PostPoll,
  mediaCount: number,
  limits?: AccountStanding['pollLimits']
): string[] {
  const rules = pollRules(channel, limits)
  if (!rules) return [`${CAPABILITIES[channel].label} posts cannot carry a poll.`]
  const problems: string[] = []
  const options = poll.options
  if (poll.multiple && channel !== 'mastodon')
    problems.push('Multiple-choice polls are supported only on Mastodon.')
  if (rules.question === 'post-text' && poll.question)
    problems.push('This poll uses the post text as its question.')
  if (rules.question === 'field') {
    const question = poll.question?.trim() ?? ''
    if (!question) problems.push('Ask the poll question.')
    else if ([...question].length > rules.questionLimit)
      problems.push(`Keep the question to ${rules.questionLimit} characters.`)
  }
  if (options.length < rules.minOptions || options.length > rules.maxOptions) {
    problems.push(`A poll has ${rules.minOptions} to ${rules.maxOptions} options.`)
  }
  if (options.some((option) => !option.trim())) problems.push('Fill in every option.')
  if (options.some((option) => [...option].length > rules.maxOptionLength)) {
    problems.push(`Keep each option to ${rules.maxOptionLength} characters.`)
  }
  if (
    !Number.isInteger(poll.durationMinutes) ||
    (rules.durationRange
      ? poll.durationMinutes < rules.durationRange.min ||
        poll.durationMinutes > rules.durationRange.max
      : !rules.durationsMinutes.includes(poll.durationMinutes))
  ) {
    problems.push(`Pick one of ${CAPABILITIES[channel].label}'s poll lengths.`)
  }
  if (mediaCount > 0 && !rules.withMedia) {
    problems.push(`${CAPABILITIES[channel].label} posts with a poll cannot have media.`)
  }
  return problems
}

/** Instance-specific rules; missing instance configuration never implies defaults. */
export function pollRules(
  channel: DraftChannel,
  limits?: AccountStanding['pollLimits']
): PollRules | null {
  if (channel === 'x') return { ...X.poll!, durationRange: { min: 5, max: 10_080 } }
  if (channel !== 'mastodon') return CAPABILITIES[channel].poll
  if (
    !limits ||
    limits.max_options < 2 ||
    limits.max_characters_per_option < 1 ||
    limits.min_expiration < 1 ||
    limits.max_expiration < limits.min_expiration
  )
    return null
  const min = Math.ceil(limits.min_expiration / 60)
  const max = Math.floor(limits.max_expiration / 60)
  if (max < min) return null
  return {
    durationsMinutes: [min, 60, 360, 1_440, 4_320, 10_080, max].filter(
      (value, index, all) => value >= min && value <= max && all.indexOf(value) === index
    ),
    durationRange: { min, max },
    maxOptionLength: limits.max_characters_per_option,
    maxOptions: limits.max_options,
    minOptions: 2,
    question: 'post-text',
    questionLimit: 500,
    withMedia: false,
  }
}
