/** A person's preferences (RFC 043); they follow the person across workspaces. */
export type UserPreferences = {
  developerMode: boolean
  dismissedTips: string[]
  emailNotifications: boolean
  experiments: Record<string, boolean>
  navigation: 'compact' | 'dynamic' | 'expanded'
  showScrollbars: boolean
  textDirection: 'ltr' | 'rtl'
  theme: 'light' | 'dark' | 'system'
  /** The display time zone; null follows the browser. */
  timeZone: string | null
  updatedAt: string | null
  version: number
  weekStart: 'monday' | 'sunday'
}

/** Changes the fields set; `baseVersion` refuses a stale save with 409. */
export type UserPreferencesUpdate = {
  baseVersion?: number
  developerMode?: boolean
  dismissTip?: string
  emailNotifications?: boolean
  experiments?: Record<string, boolean>
  navigation?: UserPreferences['navigation']
  resetTips?: boolean
  showScrollbars?: boolean
  textDirection?: UserPreferences['textDirection']
  theme?: UserPreferences['theme']
  /** An empty string follows the browser. */
  timeZone?: string
  weekStart?: UserPreferences['weekStart']
}

/** One experiment as a person sees it in a workspace. */
export type ExperimentState = {
  dependencies: string[]
  description: string
  disabledByAdmin: boolean
  enabled: boolean
  enforcement: string
  entitled: boolean
  entitlement: string
  id: string
  minAppVersion: string
  name: string
  optedIn: boolean
  status: 'experimental' | 'available' | 'promoted' | 'unavailable'
  userEditable: boolean
}

/** Something that must be resolved before an account can be deleted. */
export type AccountDeletionBlocker = {
  code: 'owns_workspace'
  message: string
  workspaceId: string
  workspaceName: string
}

/** The open account deletion request, if any, and what blocks one. */
export type AccountDeletionStatus = {
  blockers: AccountDeletionBlocker[]
  request: {
    executeAfter: string
    id: string
    requestedAt: string
    status: 'REQUESTED' | 'CANCELLED' | 'COMPLETED'
  } | null
}

/** An account's state, read from the social service. */
export type SocialAccountHealth =
  'connected' | 'reconnect_required' | 'expired' | 'revoked' | 'removed' | 'permission_required'

/** One connected account in a social set. */
export type SocialAccount = {
  avatarUrl: string | null
  createdAt: string
  displayName: string | null
  handle: string | null
  health: SocialAccountHealth
  id: string
  platform: string
  /** X Premium, read from the account (RFC 042); never the workspace's plan. */
  premium: boolean
  socialSetId: string | null
}

/** One X follow-up a new draft starts with. */
export type EngagementRule = { atLikes: number; enabled: boolean; text?: string }

/** A set's default X follow-ups. */
export type Engagement = { autoPlug: EngagementRule; autoRepost: EngagementRule }

/** How a set writes; it refines the workspace brand voice. */
export type StyleGuide = {
  audience: string
  endings: string[]
  formatting: string
  openings: string[]
  platformGuidance: Record<string, string>
  prohibitedPhrases: string[]
  terminology: string[]
  tone: string
}

/** A set's Writing Assistant with its derived status. */
export type WritingAssistant = {
  configuredAt: string | null
  sampleCount: number
  status: 'not_configured' | 'in_progress' | 'configured' | 'disabled' | 'attention'
  styleGuide: StyleGuide
}

/** A weekly posting slot: a weekday (0 is Sunday) and HH:MM. */
export type QueueSlot = { time: string; weekday: number }

/** A publishing identity: one person's or brand's accounts and settings. */
export type SocialSet = {
  accounts: SocialAccount[]
  color: string
  createdAt: string
  defaultPlatforms: string[]
  engagementDefaults: Engagement
  id: string
  isOwner: boolean
  name: string
  naturalPostingTimes: boolean
  needsAttention: boolean
  ownerUserId: string | null
  postingSlots: QueueSlot[]
  primaryPlatform: string | null
  publicProfile: boolean
  publicSlug: string
  timeZone: string
  updatedAt: string
  version: number
  visibility: 'WORKSPACE' | 'PRIVATE'
  weeklySlotCount: number
  writingAssistant: WritingAssistant
}

/** The sets a person sees, accounts in no set, and orphaned private sets. */
export type SocialSetList = {
  items: SocialSet[]
  orphaned: { accountCount: number; id: string; name: string }[]
  unassigned: SocialAccount[]
}

/** Creates a set. */
export type SocialSetInput = {
  color?: string
  name: string
  timeZone?: string
  visibility?: SocialSet['visibility']
}

/** Changes the fields set, based on `baseVersion`. */
export type SocialSetUpdate = {
  baseVersion: number
  color?: string
  defaultPlatforms?: string[]
  engagementDefaults?: Engagement
  name?: string
  naturalPostingTimes?: boolean
  postingSlots?: QueueSlot[]
  /** An empty string clears it. */
  primaryPlatform?: string
  publicProfile?: boolean
  timeZone?: string
}

/** What removing an account or deleting a set did. */
export type SocialSetRemoval = { cancelledPostIds: string[]; draftsArchived: number }

/** A set of another workspace that can be copied here. */
export type CopyableSocialSet = {
  id: string
  name: string
  workspaceId: string
  workspaceName: string
}

/** One writing sample. */
export type WritingSample = {
  createdAt: string
  createdByUserId: string | null
  id: string
  source: 'manual' | 'draft'
  sourceDraftId: string | null
  text: string
}

/** What AI help writes with for one draft on one channel. */
export type WritingContext = {
  audience: string
  endings: string[]
  formatting: string
  openings: string[]
  platformGuidance: string
  prohibitedPhrases: string[]
  samples: string[]
  socialSetName: string
  source: 'brand' | 'social_set'
  terminology: string[]
  tone: string
}

/** A set's public profile: nothing but public identity. */
export type PublicProfile = {
  accounts: {
    avatarUrl: string | null
    displayName: string | null
    handle: string | null
    platform: string
  }[]
  color: string
  name: string
}

/** An outbound webhook, without its secret. */
export type Webhook = {
  createdAt: string
  enabled: boolean
  events: string[]
  id: string
  lastFailureAt: string | null
  lastSuccessAt: string | null
  name: string
  previousSecretExpiresAt: string | null
  updatedAt: string
  url: string
}

/** A webhook just made or rotated, with its secret, returned this once. */
export type WebhookWithSecret = { secret: string; webhook: Webhook }

/** One event owed to a webhook, and its attempts. */
export type WebhookDelivery = {
  attempts: number
  createdAt: string
  errorClass: string | null
  eventId: string
  eventType: string
  history: {
    attemptNumber: number
    durationMs: number
    errorClass: string | null
    outcome: 'SUCCEEDED' | 'FAILED'
    responseStatus: number | null
    startedAt: string
  }[]
  id: string
  lastAttemptAt: string | null
  manual: boolean
  nextAttemptAt: string | null
  responseStatus: number | null
  status: 'PENDING' | 'SENDING' | 'SUCCEEDED' | 'DEAD'
}
