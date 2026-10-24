import type { Engagement } from 'screenshot-studio-backend-sdk'
import { z } from 'zod'
import {
  type BlockImages,
  type SerializedCaption,
  type SerializedPost,
  serializeDraft,
} from '@/lib/content-drafts/serialize'
import { engagementAutomation } from '@/lib/write/automation'
import {
  type AccountStanding,
  CAPABILITIES,
  captionLimit,
  kindAvailability,
  pollProblems,
} from '@/lib/write/capabilities'
import {
  type Article,
  type Automation,
  type DraftChannel,
  type DraftKind,
  type DraftTarget,
  type PlateBody,
  type PlatformVersions,
  type PostSettings,
  replySettingsSchema,
} from '@/lib/write/document'
import { bodyFor, groupSettings, versionFor } from '@/lib/write/versions'

/**
 * What a draft publishes to one account (RFC 025): the same normalized
 * content the preview shows and the schedule sends. Built from the stored
 * primary body, the channel's version and its options, the draft's kind and
 * target, and the account's standing. Go checks the result again.
 */

/** A post's settings as the backend stores them on a scheduled post. */
export const publishOptionsSchema = z.object({
  articleCoverAssetId: z.string().optional(),
  articleTitle: z.string().optional(),
  communityId: z.string().optional(),
  documentAssetId: z.string().optional(),
  documentTitle: z.string().optional(),
  firstComment: z.string().optional(),
  madeWithAi: z.boolean().optional(),
  paidPartnership: z.boolean().optional(),
  pollQuestion: z.string().optional(),
  quoteFirstPost: z.boolean().optional(),
  quoteRemoteId: z.string().optional(),
  replySettings: replySettingsSchema.exclude(['everyone']).optional(),
  shareWithFollowers: z.boolean().optional(),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional(),
})

/** One of {@link publishOptionsSchema}. */
export type PublishOptions = z.infer<typeof publishOptionsSchema>

/** One destination of a schedule request, as Go takes it. */
export type PublicationTarget = {
  assetIds: string[]
  caption: string
  channelConnectionId: string
  options?: PublishOptions
  /** X follow-ups once live (Auto-RT, Auto-Plug). */
  autoActions?: Automation
  poll?: { durationMinutes: number; options: string[] }
  replies?: { assetIds: string[]; caption: string; options?: PublishOptions }[]
  replyTo?: string
}

/** The draft parts a publication is built from. */
export type PublicationDraft = {
  article: Article | null
  body: PlateBody
  /** The follow-ups the draft copied from its set (RFC 024), until its X version sets its own. */
  engagement?: Engagement
  kind: DraftKind
  platformVersions: PlatformVersions
  target: DraftTarget | null
}

/** One account the draft goes to. */
export type PublicationAccount = {
  channel: DraftChannel
  connectionId: string
  standing?: AccountStanding
}

/** A destination's publication: what it sends, how it previews, and what blocks it. */
export type Publication = {
  /** Blocking problems: nothing can be scheduled while any remain. */
  problems: string[]
  /** Each post's settings, by its index in `serialized.posts`. */
  settings: PostSettings[]
  serialized: SerializedCaption
  target: PublicationTarget
}

/** A post's settings as options: everyone's replies is the default, so it is left out. */
function postOptions(
  channel: DraftChannel,
  settings: PostSettings,
  first: boolean
): PublishOptions {
  const capabilities = CAPABILITIES[channel].settings
  const options: PublishOptions = {}
  if (
    capabilities.replySettings &&
    settings.replySettings &&
    settings.replySettings !== 'everyone'
  ) {
    options.replySettings = settings.replySettings
  }
  if (capabilities.disclosures) {
    if (settings.disclosures?.madeWithAi) options.madeWithAi = true
    if (settings.disclosures?.paidPartnership) options.paidPartnership = true
  }
  if (channel === 'x' && settings.quoteFirstPost && !first) options.quoteFirstPost = true
  return options
}

/** Follow-ups that do something, or undefined when none is on. */
export function activeAutomation(automation: Automation | undefined): Automation | undefined {
  if (!automation) return undefined
  const active: Automation = {}
  if (automation.retweets?.length) {
    active.retweets = automation.retweets
    if (automation.unretweetAfterMinutes)
      active.unretweetAfterMinutes = automation.unretweetAfterMinutes
  }
  if (automation.plugAtLikes) {
    active.plugAtLikes = automation.plugAtLikes
    active.plugMetric = automation.plugMetric ?? 'likes'
    active.plugText = automation.plugText
  }
  if (automation.repostAtLikes) active.repostAtLikes = automation.repostAtLikes
  if (automation.quoteAfterHours && automation.quoteText?.trim()) {
    active.quoteAfterHours = automation.quoteAfterHours
    active.quoteText = automation.quoteText
  }
  return Object.keys(active).length > 0 ? active : undefined
}

/** Options without empty fields, or undefined when nothing is set. */
function compact(options: PublishOptions): PublishOptions | undefined {
  const entries = Object.entries(options).filter(
    ([, value]) => value !== undefined && value !== '' && value !== false
  )
  return entries.length > 0 ? (Object.fromEntries(entries) as PublishOptions) : undefined
}

/** The poll on the first post, as the platform takes it, with its problems. */
function firstPoll(
  channel: DraftChannel,
  settings: PostSettings | undefined,
  first: SerializedPost | undefined,
  media: number
): { poll?: PublicationTarget['poll']; problems: string[]; question?: string } {
  const poll = settings?.poll
  if (!poll) return { problems: [] }
  const problems = pollProblems(channel, poll, media)
  if (channel === 'x' && !first?.caption.trim())
    problems.push('An X poll asks the post’s text: write the question.')
  return {
    poll: {
      durationMinutes: poll.durationMinutes,
      options: poll.options.map((option) => option.trim()),
    },
    problems,
    question: CAPABILITIES[channel].poll?.question === 'field' ? poll.question?.trim() : undefined,
  }
}

/** Build what a draft publishes to one account. */
export function buildPublication(
  draft: PublicationDraft,
  account: PublicationAccount,
  blockImages?: BlockImages
): Publication {
  const { channel } = account
  const version = versionFor(draft.platformVersions, channel)
  const body = bodyFor(draft.body, draft.platformVersions, channel)
  const groups = groupSettings(body)
  const options = version.options ?? {}
  const article = draft.kind === 'article'
  const serialized = serializeDraft(body, channel, blockImages, undefined, {
    limit: article ? 100_000 : captionLimit(channel, account.standing),
    numbering: CAPABILITIES[channel].thread ? options.numbering : undefined,
  })
  const settings = serialized.posts.map((post) => groups[post.group] ?? {})
  const [first, ...rest] = serialized.posts
  const problems = [...serialized.errors]
  const availability = kindAvailability(channel, draft.kind, account.standing)
  if (!availability.available) problems.push(availability.reason)
  if (channel === 'x' && settings.some((setting, index) => index > 0 && setting.quoteFirstPost)) {
    const quote = kindAvailability(channel, 'quote', account.standing)
    if (!quote.available) problems.push(quote.reason)
  }

  const documentMedia = channel === 'linkedin' && options.document ? 1 : 0
  if (documentMedia && (first?.images ?? 0) > 0) {
    problems.push('A LinkedIn document goes alone: remove the images or the document.')
  }
  const poll = firstPoll(channel, settings[0], first, (first?.images ?? 0) + documentMedia)
  problems.push(...poll.problems)

  const firstOptions: PublishOptions = { ...postOptions(channel, settings[0] ?? {}, true) }
  if (channel === 'x' && options.community) {
    firstOptions.communityId = options.community.id
    firstOptions.shareWithFollowers = options.community.shareWithFollowers ?? false
  }
  if (channel === 'linkedin') {
    if (options.visibility) firstOptions.visibility = options.visibility
    if (options.firstComment?.trim()) firstOptions.firstComment = options.firstComment.trim()
    if (options.document) {
      firstOptions.documentAssetId = options.document.assetId
      firstOptions.documentTitle = options.document.title
    }
  }
  if (poll.question) firstOptions.pollQuestion = poll.question
  const automation =
    channel === 'x'
      ? activeAutomation(options.automation ?? engagementAutomation(draft.engagement))
      : undefined
  if (automation?.plugAtLikes && !automation.plugText?.trim())
    problems.push('The auto plug needs its reply text.')
  let replyTo: string | undefined
  if (draft.kind === 'reply') {
    if (draft.target?.platform === channel && draft.target.remoteId) replyTo = draft.target.remoteId
    else problems.push('A reply names the X post it answers.')
  }
  if (draft.kind === 'quote') {
    if (draft.target?.platform === channel && draft.target.remoteId)
      firstOptions.quoteRemoteId = draft.target.remoteId
    else
      problems.push(
        `A quote on ${CAPABILITIES[channel].label} quotes a ${CAPABILITIES[channel].label} post.`
      )
  }
  if (article) {
    if (!draft.article?.title.trim()) problems.push('Give the article a title.')
    firstOptions.articleTitle = draft.article?.title.trim()
    firstOptions.articleCoverAssetId = draft.article?.coverAssetId
  }
  const target: PublicationTarget = {
    assetIds: first?.assetIds ?? [],
    caption: first?.caption ?? '',
    channelConnectionId: account.connectionId,
    ...(compact(firstOptions) ? { options: compact(firstOptions) } : {}),
    ...(automation ? { autoActions: automation } : {}),
    ...(poll.poll ? { poll: poll.poll } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(rest.length > 0
      ? {
          replies: rest.map((post, index) => {
            const replyOptions = compact(postOptions(channel, settings[index + 1] ?? {}, false))
            return {
              assetIds: post.assetIds,
              caption: post.caption,
              ...(replyOptions ? { options: replyOptions } : {}),
            }
          }),
        }
      : {}),
  }
  return { problems: [...new Set(problems)], serialized, settings, target }
}
