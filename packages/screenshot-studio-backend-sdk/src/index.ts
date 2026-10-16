/** Typed client for the Screenshot Studio Go backend. Instantiate on a trusted server. */

/**
 * Who the web facade acts for. The backend rechecks the principal on every
 * request: a session's membership and role, an API key's validity, a support
 * grant's expiry, or a service caller's workspace.
 */
export type BackendScope = { organizationId: string; requestId: string } & (
  | { display?: string; kind?: 'session'; sessionId: string; userId: string }
  | { display: string; keyId: string; kind: 'api_key' }
  | { grantId: string; kind: 'support'; userId: string }
  | { display: string; kind: 'service' | 'webhook' }
)

export type AuthStoreWhere = {
  connector?: 'AND' | 'OR'
  field: string
  mode?: 'sensitive' | 'insensitive'
  operator?: string
  value: unknown
}

export type AuthStoreRequest = {
  data?: Record<string, unknown>
  increment?: Record<string, number>
  limit?: number
  model: string
  offset?: number
  op:
    | 'count'
    | 'consumeOne'
    | 'create'
    | 'delete'
    | 'deleteMany'
    | 'findMany'
    | 'findOne'
    | 'incrementOne'
    | 'update'
    | 'updateMany'
  select?: string[]
  sortBy?: { direction: 'asc' | 'desc'; field: string }
  where?: AuthStoreWhere[]
}

export type AuthStoreResult = {
  count?: number
  row: Record<string, unknown> | null
  rows?: Record<string, unknown>[]
}

export type BackendAuthEvent = {
  action: string
  actorDisplay?: string
  actorUserId?: string
  entityId: string
  entityType: string
  metadata?: Record<string, unknown>
  organizationId: string
  removedUserId?: string
  requestId?: string
}

export type BackendAuditEvent = {
  action: string
  entityId?: string
  entityType: string
  ipHash?: string
  metadata?: Record<string, unknown>
  outcome?: 'SUCCEEDED' | 'FAILED' | 'DENIED'
  userAgentSummary?: string
}

function principalHeaders(scope: BackendScope): Record<string, string> {
  switch (scope.kind) {
    case 'api_key':
      return {
        'x-api-key-id': scope.keyId,
        'x-principal-display': scope.display,
        'x-principal-kind': 'api_key',
      }
    case 'support':
      return {
        'x-principal-kind': 'support',
        'x-support-grant-id': scope.grantId,
        'x-user-id': scope.userId,
      }
    case 'service':
    case 'webhook':
      return { 'x-principal-display': scope.display, 'x-principal-kind': scope.kind }
    default:
      return {
        ...(scope.display ? { 'x-principal-display': scope.display } : {}),
        'x-principal-kind': 'session',
        'x-session-id': scope.sessionId,
        'x-user-id': scope.userId,
      }
  }
}

export type ScheduledPost = {
  caption: string
  channelConnection?: {
    externalAccountId: string
    platform: string
    provider: string
  }
  channelConnectionId: string
  createdAt: string
  id: string
  scheduledFor: string
  status:
    'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN_DELIVERY'
  variantId: string
}

export type ChannelConnection = {
  createdAt: string
  externalAccountId: string
  id: string
  platform: string
  provider: string
  providerSettings: Record<string, unknown>
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED'
}

export type OAuthProvider = 'x' | 'instagram' | 'instagram-standalone' | 'linkedin'
export type OAuthExchange = {
  id: string
  pages?: { id: string; pageId: string; name?: string | null }[]
}

export type BrandKit = {
  id: string
  organizationId: string
  name: string
  version: number
  definition: Record<string, unknown>
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

/**
 * How a prohibited term matches, after NFKC normalization and case folding:
 * `word` only between word boundaries, `phrase` anywhere, even inside a word.
 */
export type ProhibitedTermMatchMode = 'word' | 'phrase'

/** A term the workspace never publishes, and the reason shown when copy is blocked. */
export type ProhibitedTerm = {
  matchMode: ProhibitedTermMatchMode
  reason?: string
  term: string
}

/** A prohibited term as written: a bare string is the legacy form, a word-mode term. */
export type ProhibitedTermInput =
  string | { matchMode?: ProhibitedTermMatchMode; reason?: string; term: string }

/** A prohibited term found in copy the backend refused. */
export type ProhibitedTermMatch = ProhibitedTerm

/**
 * The prohibited terms a refused write used: a 409 whose `code` is
 * `brand_prohibited_terms`. Null for any other error.
 */
export function prohibitedTermMatches(error: unknown): ProhibitedTermMatch[] | null {
  if (
    !(error instanceof BackendSDKError) ||
    error.status !== 409 ||
    error.details.code !== 'brand_prohibited_terms'
  ) {
    return null
  }
  return Array.isArray(error.details.matches)
    ? (error.details.matches as ProhibitedTermMatch[])
    : []
}

export type BrandProfile = {
  id: string
  organizationId: string
  productDescription: string
  audience: string
  tone: string
  tagline: string | null
  ctaConventions: string | null
  prohibitedTerms: ProhibitedTerm[]
  preferredStyles: string[]
  socialHandles: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type SourceApp = {
  id: string
  organizationId: string
  name: string
  provider: string
  externalId: string | null
  branch: string | null
  ignoreBotPullRequests: boolean
  ignoredPullRequestAuthors: string[]
  skipPrereleases: boolean
  secretReference: string | null
  allowedHosts: string[]
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export type ProductSurface = {
  id: string
  organizationId: string
  name: string
  /** Stable and URL-safe, unique per workspace; set from the name at creation. */
  slug: string
  url: string
  environment: 'production' | 'staging' | 'demo' | 'development'
  description: string | null
  featureTags: string[]
  /** The newest capture assets, at most 50; `listSurfaceCaptures` is the record. */
  screenshotAssetIds: string[]
  lastCapturedAt: string | null
  /** Why the newest capture attempt failed, such as `capture_failed`. */
  lastCaptureFailureCode: string | null
  createdAt: string
  updatedAt: string
}

/** Where a surface capture came from. */
export type SurfaceCaptureSource = 'deployment' | 'agent' | 'release' | 'manual'

/** One screenshot of a surface. The current capture has no `supersededAt`. */
export type SurfaceCapture = {
  assetId: string
  capturedAt: string
  id: string
  source: SurfaceCaptureSource
  /** The deployment event, release, or run that produced it. */
  sourceId: string | null
  supersededAt: string | null
  surfaceId: string
}

/** Why a surface matched a feature, strongest first. */
export type SurfaceMatchReason = 'tag' | 'name' | 'token_overlap' | 'fallback'

/**
 * A surface for a feature. Score is 100 for a tag, 90 for a slug or name,
 * 10-70 by token overlap, and 0 for the fallback: the homepage, returned when
 * nothing matched, which a caller should not present as the feature's screen.
 */
export type SurfaceMatch = {
  currentCaptureAssetId: string | null
  reason: SurfaceMatchReason
  score: number
  surface: ProductSurface
}

/** A claim about the product and the page it came from. */
export type ProductProofPoint = { claim: string; sourceUrl?: string }

/** Where a product profile field's value came from. An edited field is locked. */
export type ProductProfileProvenance = {
  editedByUser: boolean
  source: 'manual' | 'automated'
  updatedAt: string
  url?: string
}

/** A product profile field name. */
export type ProductProfileField =
  | 'name'
  | 'url'
  | 'summary'
  | 'problem'
  | 'audience'
  | 'capabilities'
  | 'proofPoints'
  | 'pricingNote'
  | 'competitors'

/** The workspace's product memory, one per workspace. */
export type ProductProfile = {
  audience: string
  capabilities: string[]
  competitors: string[]
  createdAt: string
  id: string
  name: string
  pricingNote: string
  problem: string
  proofPoints: ProductProofPoint[]
  provenance: Partial<Record<ProductProfileField, ProductProfileProvenance>>
  summary: string
  updatedAt: string
  url: string
}

/**
 * A product profile change: only the fields given change. A manual change
 * (the default) locks each changed field; an automated one skips locked
 * fields. `unlockFields` lets automated changes update those fields again.
 */
export type UpsertProductProfileInput = {
  audience?: string
  capabilities?: string[]
  competitors?: string[]
  name?: string
  pricingNote?: string
  problem?: string
  proofPoints?: ProductProofPoint[]
  source?: 'manual' | 'automated'
  /** The page each automated value came from. */
  sourceUrls?: Partial<Record<ProductProfileField, string>>
  summary?: string
  unlockFields?: ProductProfileField[]
  url?: string
}

/**
 * A hand edit to a post, made against `expectedCopy`; other copy is a 409.
 * An empty `callToAction` or `title` clears it.
 */
export type UpdateCampaignPostInput = {
  callToAction?: string
  copy?: string
  expectedCopy: string
  title?: string
}

export type CreateProductSurfaceInput = {
  description?: string
  environment: ProductSurface['environment']
  featureTags: string[]
  name: string
  screenshotAssetIds: string[]
  url: string
}

export type UpdateProductSurfaceInput = Partial<CreateProductSurfaceInput>

export type WorkspaceSettings = {
  organizationId: string
  description: string | null
  locale: string
  timeZone: string
  defaultPublishTime: string
  /** The workspace AI agent kill switch; on unless an owner or admin turned it off. */
  aiAgentEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type Workspace = {
  id: string
  createdAt: string
  logo: string | null
  name: string
  slug: string
  workspaceSettings: WorkspaceSettings | null
}

export type BackendBootstrapSnapshot = {
  user: { id: string; name: string | null; email: string }
  organization: { id: string; logo: string | null; name: string; slug: string }
  organizations: ListedWorkspace[]
  role: string
  settings: Pick<WorkspaceSettings, 'locale' | 'timeZone' | 'defaultPublishTime'> | null
  entitlements: { features: Record<string, boolean>; plan: string; status: string }
  capabilities: {
    /** Whether AI agent runs are allowed in this workspace (the kill switch). */
    aiAgent: boolean
    browserAutomation: boolean
    engineeringAgent: boolean
    publishing: boolean
    voiceCapture: boolean
    workflows: boolean
  }
  counters: { approvals: number; attention: number }
}

export type BackendCurrentUser = {
  id: string
  email: string
  image: string | null
  name: string | null
}

export type BackendActiveAccess = { organizationId: string; role: string }

export type BackendSupportGrant = { grantId: string; organizationId: string }

export type BackendAsset = {
  id: string
  objectKey: string
  status: 'PENDING' | 'UPLOADED' | 'FAILED' | 'DELETED'
}

export type BackendAssetListItem = {
  bytes: number
  createdAt: string
  height: number | null
  id: string
  mediaType: string
  width: number | null
}

export type BackendAssetPage = { assets: BackendAssetListItem[]; nextCursor: string | null }

export type BackendAssetUploadInput = {
  bytes: number
  classification?: 'capture' | 'derived' | 'export' | 'input'
  contentType: string
  fileName: string
  sha256?: string
}

export type BackendReleaseSummary = {
  id: string
  productSurfaceId: string | null
  status: 'DRAFT' | 'READY' | 'ARCHIVED' | 'CANCELLED'
  title: string
}

export type BackendReleaseListItem = BackendReleaseSummary & {
  benefitStatement: string
  features?: ReleaseFeature[]
  screenshotAssetIds?: string[]
  createdAt: string
  updatedAt: string
}

export type BackendReleaseDetail = BackendReleaseListItem & {
  audience: string | null
  description: string | null
  productSurface: {
    environment: string
    id: string
    name: string
    url: string
  } | null
  sourceUrls: string[]
}

export type BackendCreateReleaseInput = {
  audience?: string
  benefitStatement: string
  description?: string
  idempotencyKey: string
  productSurfaceId?: string
  sourceUrls?: string[]
  title: string
}

export type BackendUpdateReleaseInput = Partial<{
  audience: string | null
  benefitStatement: string
  description: string | null
  productSurfaceId: string | null
  sourceUrls: string[]
  title: string
}>

export type BackendCampaignStatus = 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED' | 'ARCHIVED'

export type BackendCampaignListItem = {
  audience: string | null
  createdAt: string
  createdByUserId: string | null
  feature: string | null
  id: string
  messaging: string | null
  name: string
  objective: string
  organizationId: string
  productSurfaceId: string | null
  release: { id: string; title: string } | null
  releaseId: string | null
  status: BackendCampaignStatus
  updatedAt: string
}

export type BackendCampaignPost = {
  angleId: string | null
  approvedAt: string | null
  approvedByUserId: string | null
  callToAction: string | null
  campaignId: string
  channel: string
  claims: Record<string, unknown>[] | null
  copy: string
  createdAt: string
  creativeVariantId: string | null
  id: string
  organizationId: string
  phase: string | null
  planItemKey: string | null
  planVersion: number | null
  reviewNote: string | null
  scheduledAt: string | null
  scheduledPostId: string | null
  /** Delivery state of `scheduledPostId`; CANCELLED or FAILED can be rescheduled. */
  scheduledPostStatus: ScheduledPost['status'] | null
  specVersion: number | null
  status:
    | 'DRAFT'
    | 'READY_FOR_REVIEW'
    | 'APPROVED'
    | 'REJECTED'
    | 'NEEDS_CHANGES'
    | 'SCHEDULED'
    | 'PUBLISHED'
  title: string | null
  updatedAt: string
}

export type BackendCampaignDetail = Omit<BackendCampaignListItem, 'release'> & {
  angles: {
    campaignId: string
    createdAt: string
    hook: string
    id: string
    organizationId: string
    position: number
    title: string
    updatedAt: string
  }[]
  assets: {
    asset: {
      height: number | null
      id: string
      mediaType: string
      objectKey: string
      width: number | null
    }
    assetId: string
    campaignId: string
    caption: string | null
    createdAt: string
    id: string
    kind: string
    organizationId: string
    planAssetKey: string | null
    planVersion: number | null
    variantLabel: string | null
  }[]
  posts: BackendCampaignPost[]
  productSurface: { environment: string; id: string; name: string; url: string } | null
  release: {
    audience: string | null
    benefitStatement: string
    description: string | null
    id: string
    sourceUrls: string[]
    status: string
    title: string
    updatedAt: string
  } | null
}

export type BackendCreateCampaignInput = {
  angles: { hook: string; title: string }[]
  audience?: string
  feature?: string
  messaging?: string
  name: string
  objective: string
  posts: { angleIndex?: number; callToAction?: string; channel: string; copy: string }[]
  productSurfaceId?: string
  releaseId?: string
}

export type BackendDesign = {
  /** The newest approved render. It differs from `renderedAssetId` after a re-render. */
  approvedVariant: { id: string; sourceAssetId: string } | null
  campaignId: string | null
  createdAt: string
  createdByUserId: string | null
  critique: Record<string, unknown> | null
  document: Record<string, unknown>
  id: string
  name: string
  organizationId: string
  parentDesignId: string | null
  planAssetKey: string | null
  planVersion: number | null
  renderedAsset: {
    height: number | null
    id: string
    objectKey: string
    width: number | null
  } | null
  renderedAssetId: string | null
  renderKey: string | null
  templateId: string | null
  updatedAt: string
  variantLabel: string | null
}

export type BackendCreateDesignInput = {
  campaignId?: string
  document: unknown
  name: string
  parentDesignId?: string
  planAssetKey?: string
  planVersion?: number
  templateId?: string
  variantLabel?: string
}

/** A cloud project: an editor composition with revision-checked writes. */
export type BackendProject = {
  createdAt: string
  createdByUserId: string | null
  document: Record<string, unknown>
  documentVersion: number
  id: string
  name: string
  organizationId: string
  /** Every document write is based on this; a stale one is refused with 409. */
  revision: number
  updatedAt: string
  updatedByUserId: string | null
}

/** How a project version came to be. */
export type BackendProjectVersionKind = 'autosave' | 'named' | 'restore' | 'duplicate'

/** A snapshot in a project's history; `document` is only on a single version. */
export type BackendProjectVersion = {
  createdAt: string
  createdByName: string | null
  createdByUserId: string | null
  document?: Record<string, unknown>
  id: string
  kind: BackendProjectVersionKind
  name: string | null
  projectId: string
  revision: number
}

/** Filters for a project list; `cursor` comes from the previous page. */
export type BackendProjectListQuery = {
  cursor?: string
  limit?: number
  search?: string
  sort?: 'updated' | 'name'
}

/** Who may open a share link: anyone with it, or members of its workspace. */
export type ShareLinkAccess = 'PUBLIC' | 'WORKSPACE'

/** A published artifact, as its workspace sees it. */
export type BackendShareLink = {
  access: ShareLinkAccess
  altText: string | null
  assetId: string
  createdAt: string
  description: string | null
  expiresAt: string | null
  height: number | null
  id: string
  mediaType: string
  posterAssetId: string | null
  projectId: string | null
  revokedAt: string | null
  title: string
  token: string
  updatedAt: string
  width: number | null
}

/** What a share page may show for a live link. */
export type BackendPublicShareLink = {
  access: ShareLinkAccess
  altText: string | null
  createdAt: string
  description: string | null
  expiresAt: string | null
  height: number | null
  mediaType: string
  organizationId: string
  posterMediaType: string | null
  title: string
  width: number | null
}

/** A provider an integration connects. */
export type IntegrationProvider = 'SLACK' | 'NOTION' | 'FIGMA'

/** A workspace's connection to a provider account, without credentials. */
export type BackendIntegration = {
  createdAt: string
  createdByUserId: string | null
  displayName: string
  externalId: string
  id: string
  provider: IntegrationProvider
  scopes: string[]
  tokenExpiresAt: string | null
  updatedAt: string
}

export type BackendCreativeTemplate = {
  createdAt: string
  definition: Record<string, unknown>
  id: string
  name: string
  status: string
  version: number
}

/** A fixed image to publish: a design render, or a brand kit and template version. */
export type BackendCreativeVariant = {
  aspectRatio: string
  brandKitId: string | null
  brandKitVersion: number | null
  designId: string | null
  id: string
  releaseId: string
  revision: number
  sourceAssetId: string
  status: string
  templateId: string | null
  templateVersion: number | null
}

export type BackendCreativeApproval = {
  createdAt: string
  decidedAt: string | null
  decidedByUserId: string | null
  id: string
  organizationId: string
  reason: string | null
  status: string
  updatedAt: string
  variantId: string
}

export type BackendEntitlementSummary = {
  features: Record<string, boolean>
  plan: string
  status: string
}

export type BackendFeatureDecision = { allowed: boolean; currentPlan: string; requiredPlan: string }

export type BackendScreenshotCacheEntry = {
  cloudinaryPublicId: string
  cloudinaryUrl: string
  createdAt: string
  url: string
  urlHash: string
}

/** Exactly one selector: exact normalized URLs, or entries created before an ISO time. */
export type BackendScreenshotCacheFilter = { createdBefore: string } | { urls: string[] }

export type BackendRenderAsset = {
  height: number | null
  id: string
  mediaType: string
  objectKey: string
  sha256: string | null
  status: BackendAsset['status']
  updatedAt: string
  width: number | null
}

export type BackendAnnouncement = {
  channel: string
  createdAt: string
  ctaUrl: string | null
  id: string
  scheduledFor: string | null
  status: string
}

export type BackendAnnouncementListItem = BackendAnnouncement & {
  _count: { recipients: number }
  releaseDocument: { release: { id: string; title: string }; revision: number } | null
}

export type BackendScheduleAnnouncementInput = {
  ctaUrl?: string
  idempotencyKey: string
  releaseDocumentId: string
  scheduledFor?: Date
}

export type BackendAudienceSubscriber = {
  createdAt: string
  email: string
  id: string
  name: string | null
  suppressedAt: string | null
  unsubscribedAt: string | null
}

export type BackendAuditDrain = {
  createdAt: string
  enabled: boolean
  endpoint: string
  id: string
  name: string
  provider: 'DATADOG' | 'GENERIC' | 'SPLUNK'
  updatedAt: string
}

/** The signing secret is sealed by the web facade (AES-256-GCM) before it is sent. */
export type BackendAuditDrainInput = {
  encryptedSigningSecret: string
  endpoint: string
  name: string
  provider: BackendAuditDrain['provider']
}

export type BackendAuditRetention = { legalHold: boolean; retentionDays: number }

/** Caller fingerprint recorded with an audit-control change. */
export type BackendAuditRequest = { ipHash?: string | null; userAgentSummary?: string | null }

function auditRequestHeaders(audit?: BackendAuditRequest): Record<string, string> {
  return {
    ...(audit?.ipHash ? { 'x-audit-ip-hash': audit.ipHash } : {}),
    ...(audit?.userAgentSummary ? { 'x-audit-user-agent-summary': audit.userAgentSummary } : {}),
  }
}

export type BackendWebhookSource = {
  branch: string | null
  externalId: string | null
  githubInstallationId?: string | null
  id: string
  ignoreBotPullRequests: boolean
  ignoredPullRequestAuthors: string[]
  organizationId: string
  provider: string
  secretReference: string | null
  skipPrereleases: boolean
}

/** The rules a source update may change; a `null` branch follows the repository default. */
export type SourceAppRulesUpdate = {
  branch?: string | null
  ignoreBotPullRequests?: boolean
  ignoredPullRequestAuthors?: string[]
  skipPrereleases?: boolean
}

export type BackendSourceReleaseInput = {
  audience?: string
  benefitStatement: string
  description?: string
  eventId: string
  /** The release notes in full; the backend reads features and linked PRs from them. */
  notes?: string
  repositoryId?: string
  /** owner/repo, to recognise the repository's own PR links in the notes. */
  repositoryName?: string
  sourceAppId: string
  sourceUrls?: string[]
  title: string
}

/** A pull request merged into a source's branch, held for its next release. */
export type BackendSourceChangeInput = {
  authorLogin?: string
  body: string
  eventId: string
  labels: string[]
  mergedAt: string
  number: number
  repositoryId: string
  sourceAppId: string
  title: string
  url: string
}

/** A deployment GitHub reports as live in production. */
export type BackendDeploymentInput = {
  environment: string
  eventId: string
  externalId: string
  sha?: string
  sourceAppId: string
  url?: string
}

/** A workspace's link to an installation of the platform's GitHub App. */
export type GitHubConnection = {
  accountLogin: string
  accountType: string
  createdAt: string
  id: string
  installationId: number
  repositorySelection: string
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
}

/** A repository an installation can read. */
export type GitHubRepository = {
  defaultBranch: string
  fullName: string
  id: number
  private: boolean
}

/** An installation as GitHub's lifecycle events report it. */
export type GitHubInstallationRecord = {
  accountLogin: string
  accountType: string
  repositorySelection: string
  suspended: boolean
}

/** A paid AI credit pack the web facade verified with the billing provider. */
export type BackendCreditGrant = {
  credits: number
  organizationId: string
  provider: string
  /** The provider's id for the purchase; a repeated reference grants nothing. */
  reference: string
}

/** A billing provider event whose HMAC the web facade already verified. */
export type BackendEntitlementSync = {
  eventId: string
  eventType: string
  expectedVersion: number
  externalCustomerId?: string | null
  externalSubscriptionId?: string | null
  featureOverrides: Partial<Record<string, boolean>>
  graceUntil?: Date | null
  organizationId: string
  plan: 'business' | 'enterprise' | 'free' | 'pro'
  provider: string
  status: 'active' | 'cancelled' | 'past_due' | 'suspended' | 'trialing'
  validUntil?: Date | null
}

export type BackendWorkspaceEntitlement = {
  featureOverrides: Record<string, boolean> | null
  graceUntil: string | null
  lastSyncedAt: string | null
  plan: string
  status: string
  validUntil: string | null
  version: number
}

export type BackendLaunchCampaign = {
  id: string
  name: string
  objective: string
  productSurface: { environment: string; id: string; name: string; url: string } | null
  release: {
    audience: string | null
    benefitStatement: string
    createdByUserId: string | null
    description: string | null
    features?: ReleaseFeature[]
    id: string
    notes?: string | null
    sourceUrls: string[]
    title: string
  } | null
}

/** One line of a release, read from its notes or a merged pull request. */
export type ReleaseFeature = {
  author?: string
  kind: 'feature' | 'improvement' | 'fix' | 'internal' | 'other'
  number?: number
  title: string
  url?: string
}

export type BackendLaunchSpec = {
  approvedAt: string | null
  changeSummary: string | null
  content: unknown
  createdAt: string
  id: string
  modelId: string | null
  origin: string
  releaseId: string
  sources: unknown
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED'
  version: number
}

export type BackendLaunchPlan = Omit<BackendLaunchSpec, 'releaseId' | 'sources'> & {
  campaignId: string
  specId: string | null
}

export type BackendLaunchRevision = {
  campaignId: string
  comment: string
  createdAt: string
  decidedAt: string | null
  id: string
  modelId: string | null
  proposal: unknown
  status: 'PROPOSED' | 'APPLIED' | 'DISCARDED'
  targetId: string
  targetKey: string | null
  targetType: string
}

export type BackendLaunchRun = {
  campaignId: string
  error: string | null
  finishedAt: string | null
  /** Last time the worker reported it was alive. */
  heartbeatAt: string | null
  id: string
  kind: string
  resultId: string | null
  startedAt: string
  status: 'FAILED' | 'RUNNING' | 'SUCCEEDED'
  summary: string | null
}

/** Every launch run status. Pipeline runs only reach RUNNING, SUCCEEDED, and FAILED. */
export type BackendLaunchRunStatus =
  | 'BUDGET_EXHAUSTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RUNNING'
  | 'SUCCEEDED'

/** An agent or conversation run (RFC 016). It may have no campaign. */
export type BackendAgentRun = Omit<BackendLaunchRun, 'campaignId' | 'kind' | 'status'> & {
  campaignId: string | null
  costCents: number
  kind: 'agent' | 'conversation'
  status: BackendLaunchRunStatus
  stepCount: number
  tokensIn: number
  tokensOut: number
}

/** A step outcome; DENIED is a tool call refused by authorization. */
export type BackendLaunchRunStepStatus = 'DENIED' | 'FAILED' | 'SUCCEEDED'

/** What a tool call does, from its capability record. */
export type BackendToolEffect = 'approval-request' | 'external' | 'read' | 'render' | 'write'

/**
 * One step a worker appends. `index` is the worker's step number: re-sending
 * a recorded index answers 409, so a resumed worker never duplicates a step.
 * Summaries are redacted by the caller; the backend also blanks
 * credential-like keys and caps each at 16 KiB.
 */
export type BackendLaunchRunStepInput = {
  durationMs?: number
  effect?: BackendToolEffect | null
  errorCode?: string | null
  index: number
  inputSummary?: unknown
  kind: 'model' | 'tool'
  outputSummary?: unknown
  status: BackendLaunchRunStepStatus
  tokensIn?: number
  tokensOut?: number
  /** Required for a tool step, absent for a model step. */
  toolName?: string | null
}

/** A persisted step of a run's trace. */
export type BackendLaunchRunStep = {
  createdAt: string
  durationMs: number
  effect: BackendToolEffect | null
  errorCode: string | null
  id: string
  index: number
  inputSummary: unknown
  kind: 'model' | 'tool'
  outputSummary: unknown
  runId: string
  status: BackendLaunchRunStepStatus
  tokensIn: number
  tokensOut: number
  toolName: string | null
}

/** A workspace-visible conversation (RFC 017), without its messages. */
export type BackendConversation = {
  campaignId: string | null
  createdAt: string
  createdByUserId: string | null
  id: string
  status: 'ACTIVE' | 'ARCHIVED'
  title: string
  updatedAt: string
}

export type BackendConversationMessageRole = 'assistant' | 'tool' | 'user'
export type BackendConversationMessageKind = 'clarification' | 'text' | 'tool'

export type BackendConversationMessage = {
  content: string
  conversationId: string
  createdAt: string
  id: string
  kind: BackendConversationMessageKind
  launchRunId: string | null
  metadata: unknown
  role: BackendConversationMessageRole
  toolName: string | null
}

/**
 * A message to append. Any member sends a plain user text message; any
 * other role or kind needs owner, admin, or creator, or the conversation's
 * author citing (`launchRunId`) a conversation run they started. Content is
 * at most 20,000 characters.
 */
export type BackendConversationMessageInput = {
  content: string
  kind: BackendConversationMessageKind
  launchRunId?: string | null
  metadata?: unknown
  role: BackendConversationMessageRole
  toolName?: string | null
}

/** A conversation change for its author or an owner or admin; `campaignId: null` unlinks. */
export type BackendConversationUpdate = {
  campaignId?: string | null
  status?: 'ACTIVE' | 'ARCHIVED'
  title?: string
}

/** A new spec or plan version. Metadata is flat and lands in the audit entry. */
export type BackendLaunchVersionInput = {
  changeSummary: string
  content: unknown
  metadata?: Record<string, boolean | null | number | string>
  modelId?: string | null
  origin: 'ai' | 'human' | 'revision'
}

export type BackendLaunchPostsInput = {
  angles: { hook: string; key: string; title: string }[]
  metadata?: Record<string, boolean | null | number | string>
  planVersion: number
  posts: {
    angleKey: string
    callToAction: string
    channel: string
    claims: Record<string, unknown>[]
    copy: string
    phase: string
    title: string
  }[]
  specVersion: number
}

export type BackendLaunchPreferences = {
  approved: { channel: string; copy: string; title: string | null }[]
  rejected: { channel: string; copy: string; reviewNote: string | null; status: string }[]
  revisions: { comment: string; proposal: unknown; targetType: string }[]
}

/** A campaign asset link with the upload status of its asset. */
export type BackendCampaignAssetLink = BackendCampaignDetail['assets'][number] & {
  assetStatus: 'PENDING' | 'UPLOADED' | 'FAILED' | 'DELETED'
}

/** Linking an asset again replaces its caption and provenance; null clears them. */
export type BackendLinkCampaignAssetInput = {
  caption?: string | null
  kind: string
  planAssetKey?: string | null
  planVersion?: number | null
  variantLabel?: string | null
}

export type BackendGeneratedAssetInput = {
  body: Uint8Array
  classification: 'capture' | 'derived' | 'export' | 'input'
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  fileName: string
  height: number
  parentAssetId?: string
  width: number
}

export type BackendGeneratedAsset = { id: string; mediaType: string; objectKey: string }

export type AuditLogQuery = {
  action?: string
  actorUserId?: string
  cursor?: string
  endDate?: Date
  entityType?: string
  limit?: number
  outcome?: 'SUCCEEDED' | 'FAILED' | 'DENIED'
  search?: string
  startDate?: Date
}

export type AuditLogItem = {
  id: string
  organizationId: string
  createdAt: string
  requestId: string
  actorType: 'USER' | 'SERVICE' | 'SUPPORT' | 'WEBHOOK'
  actorUserId: string | null
  actorDisplay: string | null
  action: string
  outcome: 'SUCCEEDED' | 'FAILED' | 'DENIED'
  entityType: string
  entityId: string | null
  ipHash: string | null
  userAgentSummary: string | null
  metadata: Record<string, unknown> | null
  searchText: string
}

export type AuditLogPage = { items: AuditLogItem[]; nextCursor?: string }

export type WorkspaceMutation = {
  organization: Omit<Workspace, 'workspaceSettings'>
  settings: WorkspaceSettings
}

export type ListedWorkspace = {
  id: string
  isScheduledForDeletion: boolean
  name: string
  role: string
  slug: string
  workspaceDeletion?: { requestedByUserId: string; scheduledFor: string; status: string }
}

export type UpdateWorkspaceInput = {
  /** Turns AI agent runs on or off. Owner or admin only; audited. */
  aiAgentEnabled?: boolean
  defaultPublishTime?: string
  description?: string | null
  locale?: string
  logo?: string | null
  name: string
  slug: string
  timeZone?: string
}

export type WorkspaceMember = {
  createdAt: string
  id: string
  role: string
  user: { email: string; id: string; image: string | null; name: string }
}

export type WorkspaceInvitation = {
  createdAt: string
  email: string
  expiresAt: string
  id: string
  role: string | null
  status: string
}

export type WorkspaceInvitationDetail = WorkspaceInvitation & {
  organization: { name: string }
  user: { email: string; name: string }
}

export type WorkspaceDeletion = {
  id: string
  organizationId: string
  requestedByUserId: string
  status: 'PENDING' | 'PROCESSING' | 'CANCELLED' | 'PURGED'
  scheduledFor: string
  cancelledAt: string | null
  processingAt: string | null
  purgedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export class BackendSDKError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    /** The backend's error body, e.g. a quota's limit and reset time. */
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'BackendSDKError'
  }
}

export class ScreenshotStudioBackendSDK {
  private readonly baseURL: string

  constructor(
    baseURL: string,
    private readonly serviceToken: string,
    private readonly scope: BackendScope,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!baseURL || !serviceToken) {
      throw new BackendSDKError('Publishing backend is not configured.', 503)
    }
    this.baseURL = `${baseURL.replace(/\/$/, '')}/`
  }

  private async request<T>(
    path: string,
    init: {
      body?: unknown
      headers?: Record<string, string>
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
      rawBody?: BodyInit
      responseType?: 'bytes'
    } = {}
  ) {
    let response: Response
    try {
      response = await this.fetcher(new URL(path, this.baseURL), {
        body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          'content-type': 'application/json',
          'x-organization-id': this.scope.organizationId,
          'x-request-id': this.scope.requestId,
          ...principalHeaders(this.scope),
          ...init.headers,
        },
        method: init.method ?? 'GET',
      })
    } catch {
      throw new BackendSDKError('Publishing backend is unavailable.', 503)
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as
        ({ error?: string } & Record<string, unknown>) | null
      const status =
        ([400, 401, 403, 404, 409, 429] as const).find((value) => value === response.status) ?? 503
      throw new BackendSDKError(error?.error ?? 'Publishing request failed.', status, error ?? {})
    }
    return (
      init.responseType === 'bytes'
        ? new Uint8Array(await response.arrayBuffer())
        : await response.json()
    ) as T
  }

  async listScheduledPosts(limit: number) {
    return this.request<{ items: ScheduledPost[] }>(`v1/scheduled-posts?limit=${limit}`)
  }

  async createScheduledPost(input: {
    caption: string
    channelConnectionId: string
    idempotencyKey: string
    scheduledFor: Date
    variantId: string
  }) {
    return this.request<{ created: boolean; scheduledPost: ScheduledPost }>('v1/scheduled-posts', {
      body: input,
      method: 'POST',
    })
  }

  async cancelScheduledPost(id: string) {
    return this.request<ScheduledPost>(`v1/scheduled-posts/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    })
  }

  async listConnections() {
    return this.request<{ items: ChannelConnection[] }>('v1/channel-connections')
  }

  async createConnection(input: {
    externalAccountId: string
    platform: string
    providerSettings: Record<string, unknown>
    secretReference: string
  }) {
    return this.request<ChannelConnection>('v1/channel-connections', {
      body: input,
      method: 'POST',
    })
  }

  async beginSocialOAuth(provider: OAuthProvider) {
    return this.request<{ url: string }>('v1/social-oauth/begin', {
      body: { provider },
      method: 'POST',
    })
  }

  async verifySocialOAuth(provider: OAuthProvider, state: string, integrationId?: string) {
    return this.request('v1/social-oauth/verify', {
      body: { provider, state, integrationId },
      method: 'POST',
    })
  }

  async exchangeSocialOAuth(provider: OAuthProvider, state: string, code: string) {
    return this.request<OAuthExchange>('v1/social-oauth/exchange', {
      body: { provider, state, code },
      method: 'POST',
    })
  }

  async selectInstagramOAuthPage(input: {
    state: string
    integrationId: string
    accountId: string
    pageId: string
  }) {
    return this.request<{ selected: boolean }>('v1/social-oauth/page', {
      body: input,
      method: 'POST',
    })
  }

  async rememberInstagramIntegration(state: string, integrationId: string) {
    return this.request('v1/social-oauth/remember', {
      body: { provider: 'instagram', state, integrationId },
      method: 'POST',
    })
  }

  async completeSocialOAuth(provider: OAuthProvider, state: string, integrationId: string) {
    return this.request('v1/social-oauth/complete', {
      body: { provider, state, integrationId },
      method: 'POST',
    })
  }

  async listBrandKits() {
    return this.request<{ brandKits: BrandKit[] }>('v1/brand-kits')
  }

  async createBrandKit(input: {
    definition: Record<string, unknown>
    name: string
    publish: boolean
  }) {
    return this.request<BrandKit>('v1/brand-kits', { body: input, method: 'POST' })
  }

  /** Rename every version of the brand kit `id` belongs to. */
  async renameBrandKit(id: string, name: string) {
    return this.request<BrandKit>(`v1/brand-kits/${encodeURIComponent(id)}`, {
      body: { name },
      method: 'PATCH',
    })
  }

  /** Archive every version of the brand kit `id` belongs to. */
  async archiveBrandKit(id: string) {
    return this.request<{ archived: true }>(`v1/brand-kits/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async getBrandProfile() {
    return this.request<{ brandProfile: BrandProfile | null }>('v1/brand-profile')
  }

  async upsertBrandProfile(input: {
    audience: string
    ctaConventions?: string
    preferredStyles: string[]
    productDescription: string
    prohibitedTerms: ProhibitedTermInput[]
    socialHandles: Record<string, string>
    tagline?: string
    tone: string
  }) {
    return this.request<BrandProfile>('v1/brand-profile', { body: input, method: 'POST' })
  }

  /** The workspace's product profile, or null before one is saved. */
  async getProductProfile() {
    return this.request<{ productProfile: ProductProfile | null }>('v1/product-profile')
  }

  /** Creates or changes the product profile; owner or admin only. */
  async upsertProductProfile(input: UpsertProductProfileInput) {
    return this.request<ProductProfile>('v1/product-profile', { body: input, method: 'POST' })
  }

  async createSourceApp(input: {
    allowedHosts: string[]
    branch?: string
    externalId?: string
    githubConnectionId?: string
    ignoreBotPullRequests?: boolean
    ignoredPullRequestAuthors?: string[]
    name: string
    provider: string
    secretReference?: string
    skipPrereleases?: boolean
  }) {
    return this.request<SourceApp>('v1/source-apps', { body: input, method: 'POST' })
  }

  async updateSourceApp(sourceAppId: string, input: SourceAppRulesUpdate) {
    return this.request<SourceApp>(`v1/source-apps/${encodeURIComponent(sourceAppId)}`, {
      body: input,
      method: 'PATCH',
    })
  }

  async listProductSurfaces() {
    return this.request<{ productSurfaces: ProductSurface[] }>('v1/product-surfaces')
  }

  async createProductSurface(input: CreateProductSurfaceInput) {
    return this.request<ProductSurface>('v1/product-surfaces', { body: input, method: 'POST' })
  }

  async updateProductSurface(id: string, input: UpdateProductSurfaceInput) {
    return this.request<ProductSurface>(`v1/product-surfaces/${encodeURIComponent(id)}`, {
      body: input,
      method: 'PATCH',
    })
  }

  async deleteProductSurface(id: string) {
    return this.request<{ deleted: true }>(`v1/product-surfaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  /** Ranks surfaces for a feature with no model involved; see `SurfaceMatch`. */
  async findSurfacesForFeature(input: { feature: string; limit?: number; tags?: string[] }) {
    const query = new URLSearchParams({ feature: input.feature })
    for (const tag of input.tags ?? []) query.append('tag', tag)
    if (input.limit !== undefined) query.set('limit', String(input.limit))
    return this.request<{ matches: SurfaceMatch[] }>(`v1/product-surfaces/match?${query}`)
  }

  /** A surface's 50 newest captures, current first. */
  async listSurfaceCaptures(surfaceId: string) {
    return this.request<{ captures: SurfaceCapture[] }>(
      `v1/product-surfaces/${encodeURIComponent(surfaceId)}/captures`
    )
  }

  /** Makes an uploaded image the surface's current capture, superseding the last. */
  async recordSurfaceCapture(
    surfaceId: string,
    input: {
      assetId: string
      source: Exclude<SurfaceCaptureSource, 'deployment'>
      sourceId?: string
    }
  ) {
    return this.request<SurfaceCapture>(
      `v1/product-surfaces/${encodeURIComponent(surfaceId)}/captures`,
      { body: input, method: 'POST' }
    )
  }

  async createWorkspace(input: { name: string; slug: string }) {
    return this.request<WorkspaceMutation>('v1/workspaces', { body: input, method: 'POST' })
  }

  async listWorkspaces() {
    return this.request<{ workspaces: ListedWorkspace[] }>('v1/workspaces')
  }

  async getCurrentUser() {
    return this.request<{ user: BackendCurrentUser }>('v1/me')
  }

  async getActiveAccess() {
    return this.request<BackendActiveAccess>('v1/access')
  }

  async verifySupportGrant(organizationId: string, scope: string) {
    const parameters = new URLSearchParams({ organizationId, scope })
    return this.request<BackendSupportGrant>(`v1/support-grants/verify?${parameters}`)
  }

  async requireEnterpriseFeature(feature: 'ssoEnabled' | 'scimEnabled') {
    return this.request<{ enabled: true }>(`v1/enterprise-features/${feature}`)
  }

  async listAssets(options: { cursor?: string; limit: number }) {
    const parameters = new URLSearchParams({ limit: String(options.limit) })
    if (options.cursor) parameters.set('cursor', options.cursor)
    return this.request<BackendAssetPage>(`v1/assets?${parameters}`)
  }

  async signAssetUpload(input: BackendAssetUploadInput) {
    return this.request<{ asset: BackendAsset; uploadUrl: string }>('v1/assets/upload-url', {
      body: input,
      method: 'POST',
    })
  }

  async completeAssetUpload(id: string, sha256?: string) {
    return this.request<{ asset: BackendAsset }>(`v1/assets/${encodeURIComponent(id)}/complete`, {
      body: sha256 ? { sha256 } : {},
      method: 'POST',
    })
  }

  async signAssetDownload(id: string) {
    return this.request<{ downloadUrl: string }>(`v1/assets/${encodeURIComponent(id)}/download-url`)
  }

  /** Server-side asset read through the backend, where a browser URL is unreachable. */
  async readAsset(id: string) {
    return this.request<Uint8Array>(`v1/assets/${encodeURIComponent(id)}/bytes`, {
      responseType: 'bytes',
    })
  }

  async deleteAsset(id: string) {
    return this.request<{ status: 'deleted' }>(`v1/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async storeGeneratedAsset(input: BackendGeneratedAssetInput) {
    return this.request<BackendGeneratedAsset>('v1/assets/generated', {
      headers: {
        'content-type': input.contentType,
        'x-asset-classification': input.classification,
        'x-asset-file-name': input.fileName,
        'x-asset-height': String(input.height),
        'x-asset-width': String(input.width),
        ...(input.parentAssetId ? { 'x-parent-asset-id': input.parentAssetId } : {}),
      },
      method: 'POST',
      rawBody: new Uint8Array(input.body).buffer,
    })
  }

  async consumeWorkspaceQuota(quota: string, amount = 1) {
    return this.request<{ remaining: number }>('v1/quotas/consume', {
      body: { amount, quota },
      method: 'POST',
    })
  }

  async listReleases(limit: number) {
    return this.request<{ releases: BackendReleaseListItem[] }>(`v1/releases?limit=${limit}`)
  }

  async getRelease(id: string) {
    return this.request<BackendReleaseDetail>(`v1/releases/${encodeURIComponent(id)}`)
  }

  async createRelease(input: BackendCreateReleaseInput) {
    return this.request<{ created: boolean; release: BackendReleaseSummary }>('v1/releases', {
      body: input,
      method: 'POST',
    })
  }

  async updateRelease(id: string, input: BackendUpdateReleaseInput) {
    return this.request<BackendReleaseDetail>(`v1/releases/${encodeURIComponent(id)}`, {
      body: input,
      method: 'PATCH',
    })
  }

  async listCampaigns() {
    return this.request<{ campaigns: BackendCampaignListItem[] }>('v1/campaigns')
  }

  async getCampaign(id: string) {
    return this.request<BackendCampaignDetail>(`v1/campaigns/${encodeURIComponent(id)}`)
  }

  async createCampaign(input: BackendCreateCampaignInput) {
    return this.request<BackendCampaignDetail>('v1/campaigns', { body: input, method: 'POST' })
  }

  async transitionCampaign(id: string, status: BackendCampaignStatus) {
    return this.request<{ id: string; status: BackendCampaignStatus }>(
      `v1/campaigns/${encodeURIComponent(id)}/transition`,
      { body: { status }, method: 'POST' }
    )
  }

  async decideCampaignPosts(
    id: string,
    input: { decision: string; note?: string; postIds?: readonly string[] }
  ) {
    return this.request<{ postIds: string[]; status: string }>(
      `v1/campaigns/${encodeURIComponent(id)}/posts/decide`,
      { body: input, method: 'POST' }
    )
  }

  /**
   * Moves draft or needs-changes posts to review, every eligible post when
   * `postIds` is omitted. Unlike `decideCampaignPosts`, an API key with the
   * release:create scope may call it; nothing but a person approves.
   */
  async submitCampaignPosts(campaignId: string, postIds?: readonly string[]) {
    return this.request<{ postIds: string[]; status: string }>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/posts/submit`,
      { body: postIds === undefined ? {} : { postIds }, method: 'POST' }
    )
  }

  /** Edits a post's copy, call to action, or title; see `UpdateCampaignPostInput`. */
  async updateCampaignPost(campaignId: string, postId: string, input: UpdateCampaignPostInput) {
    return this.request<BackendCampaignPost>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}`,
      { body: input, method: 'PATCH' }
    )
  }

  async scheduleCampaignPost(
    campaignId: string,
    postId: string,
    input: { channelConnectionId: string; creativeVariantId?: string; scheduledAt?: string }
  ) {
    return this.request<BackendCampaignPost>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}/schedule`,
      { body: input, method: 'POST' }
    )
  }

  async listCampaignDesigns(campaignId: string) {
    return this.request<{ designs: BackendDesign[] }>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/designs`
    )
  }

  /** Approves a design's current render for publishing; repeating it is a no-op. */
  async approveCampaignDesign(campaignId: string, designId: string) {
    return this.request<{ approval: BackendCreativeApproval; variant: BackendCreativeVariant }>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/designs/${encodeURIComponent(designId)}/approval`,
      { method: 'POST' }
    )
  }

  async createDesign(input: BackendCreateDesignInput) {
    return this.request<BackendDesign>('v1/designs', { body: input, method: 'POST' })
  }

  async getDesign(id: string) {
    return this.request<BackendDesign>(`v1/designs/${encodeURIComponent(id)}`)
  }

  async updateDesignDocument(id: string, document: unknown) {
    return this.request<{ updated: true }>(`v1/designs/${encodeURIComponent(id)}/document`, {
      body: { document },
      method: 'PUT',
    })
  }

  async setDesignRender(id: string, assetId: string, renderKey: string | null) {
    return this.request<{ updated: true }>(`v1/designs/${encodeURIComponent(id)}/render`, {
      body: { assetId, renderKey },
      method: 'PUT',
    })
  }

  async listProjects(query: BackendProjectListQuery = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    return this.request<{ items: BackendProject[]; nextCursor: string | null }>(
      `v1/projects?${params}`
    )
  }

  async createProject(input: { document: unknown; name: string }) {
    return this.request<BackendProject>('v1/projects', { body: input, method: 'POST' })
  }

  async getProject(id: string) {
    return this.request<BackendProject>(`v1/projects/${encodeURIComponent(id)}`)
  }

  async renameProject(id: string, name: string) {
    return this.request<BackendProject>(`v1/projects/${encodeURIComponent(id)}`, {
      body: { name },
      method: 'PATCH',
    })
  }

  /** Writes a document based on `baseRevision`; a stale write fails with 409 and `currentRevision`. */
  async updateProjectDocument(id: string, input: { baseRevision: number; document: unknown }) {
    return this.request<{ revision: number; updatedAt: string }>(
      `v1/projects/${encodeURIComponent(id)}/document`,
      { body: input, method: 'PUT' }
    )
  }

  async duplicateProject(id: string, name?: string) {
    return this.request<BackendProject>(`v1/projects/${encodeURIComponent(id)}/duplicate`, {
      body: name === undefined ? {} : { name },
      method: 'POST',
    })
  }

  async deleteProject(id: string) {
    return this.request<{ deleted: true }>(`v1/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async listProjectVersions(id: string) {
    return this.request<{ versions: BackendProjectVersion[] }>(
      `v1/projects/${encodeURIComponent(id)}/versions`
    )
  }

  async getProjectVersion(id: string, versionId: string) {
    return this.request<BackendProjectVersion & { document: Record<string, unknown> }>(
      `v1/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`
    )
  }

  /** Names the project's current document as a version. */
  async createProjectVersion(id: string, name: string) {
    return this.request<BackendProjectVersion>(`v1/projects/${encodeURIComponent(id)}/versions`, {
      body: { name },
      method: 'POST',
    })
  }

  /** Makes a version the current document, as a new revision based on `baseRevision`. */
  async restoreProjectVersion(id: string, versionId: string, baseRevision: number) {
    return this.request<BackendProject>(
      `v1/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
      { body: { baseRevision }, method: 'POST' }
    )
  }

  async listShareLinks() {
    return this.request<{ shareLinks: BackendShareLink[] }>('v1/share-links')
  }

  async createShareLink(input: {
    access: ShareLinkAccess
    altText?: string | null
    assetId: string
    description?: string | null
    expiresAt?: string | null
    posterAssetId?: string | null
    projectId?: string | null
    title: string
  }) {
    return this.request<BackendShareLink>('v1/share-links', { body: input, method: 'POST' })
  }

  async updateShareLink(
    id: string,
    input: {
      access?: ShareLinkAccess
      altText?: string | null
      clearExpiry?: boolean
      description?: string | null
      expiresAt?: string | null
      title?: string
    }
  ) {
    return this.request<BackendShareLink>(`v1/share-links/${encodeURIComponent(id)}`, {
      body: input,
      method: 'PATCH',
    })
  }

  async revokeShareLink(id: string) {
    return this.request<{ revoked: true }>(`v1/share-links/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  /** A live link by its token, for the share page; requires the service token alone. */
  async resolveShareLink(token: string) {
    return this.request<BackendPublicShareLink>(`v1/internal/share-links/${encodeURIComponent(token)}`)
  }

  /** A live link's media or poster bytes; requires the service token alone. */
  async readShareLinkObject(token: string, variant: 'media' | 'poster') {
    return this.request<Uint8Array>(
      `v1/internal/share-links/${encodeURIComponent(token)}/object?variant=${variant}`,
      { responseType: 'bytes' }
    )
  }

  async listIntegrations() {
    return this.request<{ integrations: BackendIntegration[] }>('v1/integrations')
  }

  async saveIntegration(input: {
    displayName: string
    encryptedCredentials: string
    externalId: string
    provider: IntegrationProvider
    scopes: string[]
    tokenExpiresAt: string | null
  }) {
    return this.request<BackendIntegration>('v1/integrations', { body: input, method: 'POST' })
  }

  async integrationCredentials(id: string) {
    return this.request<BackendIntegration & { encryptedCredentials: string }>(
      `v1/integrations/${encodeURIComponent(id)}/credentials`
    )
  }

  async updateIntegrationCredentials(
    id: string,
    input: { encryptedCredentials: string; tokenExpiresAt: string | null }
  ) {
    return this.request<{ updated: true }>(`v1/integrations/${encodeURIComponent(id)}/credentials`, {
      body: input,
      method: 'PUT',
    })
  }

  async deleteIntegration(id: string) {
    return this.request<{ deleted: true }>(`v1/integrations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async listCreativeTemplates() {
    return this.request<{ templates: BackendCreativeTemplate[] }>('v1/creative-templates')
  }

  async createCreativeTemplate(input: { definition: unknown; name: string }) {
    return this.request<BackendCreativeTemplate>('v1/creative-templates', {
      body: input,
      method: 'POST',
    })
  }

  /** Rename every version of the template `id` belongs to. */
  async renameCreativeTemplate(id: string, name: string) {
    return this.request<BackendCreativeTemplate>(`v1/creative-templates/${encodeURIComponent(id)}`, {
      body: { name },
      method: 'PATCH',
    })
  }

  /** Archive every version of the template `id` belongs to. */
  async archiveCreativeTemplate(id: string) {
    return this.request<{ archived: true }>(`v1/creative-templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async createCreativeVariant(input: {
    aspectRatio: string
    brandKitId: string
    releaseId: string
    sourceAssetId: string
    templateId: string
  }) {
    return this.request<BackendCreativeVariant>('v1/creative-variants', {
      body: input,
      method: 'POST',
    })
  }

  async decideCreativeVariant(id: string, input: { reason?: string; status: string }) {
    return this.request<{ approval: BackendCreativeApproval; variant: BackendCreativeVariant }>(
      `v1/creative-variants/${encodeURIComponent(id)}/decision`,
      { body: input, method: 'POST' }
    )
  }

  async getEntitlements() {
    return this.request<BackendEntitlementSummary>('v1/entitlements')
  }

  async getFeatureDecision(feature: string) {
    return this.request<BackendFeatureDecision>(
      `v1/entitlements/features/${encodeURIComponent(feature)}`
    )
  }

  /** Better Auth adapter operations. Service-authenticated; no principal applies. */
  async authStore(request: AuthStoreRequest) {
    return this.request<AuthStoreResult>('v1/internal/auth-store', {
      body: request,
      method: 'POST',
    })
  }

  async recordAuthEvent(event: BackendAuthEvent) {
    return this.request<{ recorded: true }>('v1/internal/auth-events', {
      body: event,
      method: 'POST',
    })
  }

  async isWorkspaceOperational(organizationId: string) {
    const result = await this.request<{ operational: boolean }>(
      `v1/internal/workspaces/${encodeURIComponent(organizationId)}/operational`
    )
    return result.operational
  }

  async appendAuditEvent(event: BackendAuditEvent) {
    return this.request<{ recorded: true }>('v1/audit-events', { body: event, method: 'POST' })
  }

  /** Global screenshot cache. Service-authenticated; no principal applies. */
  async getScreenshotCache(urlHash: string) {
    return this.request<BackendScreenshotCacheEntry>(
      `v1/internal/screenshot-cache/${encodeURIComponent(urlHash)}`
    )
  }

  async getScreenshotCacheObject(urlHash: string) {
    return this.request<{ base64: string }>(
      `v1/internal/screenshot-cache/${encodeURIComponent(urlHash)}/object`
    )
  }

  async putScreenshotCacheObject(urlHash: string, body: Uint8Array) {
    return this.request<{ stored: true }>(
      `v1/internal/screenshot-cache/${encodeURIComponent(urlHash)}/object`,
      {
        headers: { 'content-type': 'image/png' },
        method: 'PUT',
        rawBody: new Uint8Array(body).buffer,
      }
    )
  }

  async putScreenshotCache(
    urlHash: string,
    input: { cloudinaryPublicId: string; cloudinaryUrl: string; url: string }
  ) {
    return this.request<BackendScreenshotCacheEntry>(
      `v1/internal/screenshot-cache/${encodeURIComponent(urlHash)}`,
      { body: input, method: 'PUT' }
    )
  }

  async deleteScreenshotCache(urlHash: string) {
    return this.request<{ deleted: true }>(
      `v1/internal/screenshot-cache/${encodeURIComponent(urlHash)}`,
      { method: 'DELETE' }
    )
  }

  async listScreenshotCache(filter: BackendScreenshotCacheFilter) {
    return this.request<{ entries: BackendScreenshotCacheEntry[] }>(
      'v1/internal/screenshot-cache/query',
      { body: filter, method: 'POST' }
    )
  }

  async purgeScreenshotCache(filter: BackendScreenshotCacheFilter) {
    return this.request<{ deleted: number }>('v1/internal/screenshot-cache/purge', {
      body: filter,
      method: 'POST',
    })
  }

  /** The workspace's assets in any status, by id or by object key. */
  async findAssets(query: { ids: string[] } | { objectKey: string }) {
    const parameters = new URLSearchParams(
      'ids' in query ? query.ids.map((id) => ['id', id]) : [['objectKey', query.objectKey]]
    )
    return this.request<{ assets: BackendRenderAsset[] }>(`v1/assets/lookup?${parameters}`)
  }

  /** The image of the newest workspace design rendered under this key. */
  async findDesignRender(renderKey: string) {
    return this.request<BackendRenderAsset>(`v1/design-renders/${encodeURIComponent(renderKey)}`)
  }

  async listAnnouncements(limit: number) {
    return this.request<{ announcements: BackendAnnouncementListItem[] }>(
      `v1/announcements?limit=${limit}`
    )
  }

  async scheduleAnnouncement(input: BackendScheduleAnnouncementInput) {
    return this.request<{ announcement: BackendAnnouncement; created: boolean }>(
      'v1/announcements',
      { body: input, method: 'POST' }
    )
  }

  async cancelAnnouncement(id: string) {
    return this.request<{ cancelled: boolean }>(
      `v1/announcements/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' }
    )
  }

  async getAudienceReach() {
    return this.request<{ reach: number }>('v1/audience/reach')
  }

  async listAudienceSubscribers(options: { includeUnsubscribed: boolean; limit: number }) {
    return this.request<{ subscribers: BackendAudienceSubscriber[] }>(
      `v1/audience/subscribers?limit=${options.limit}&includeUnsubscribed=${options.includeUnsubscribed}`
    )
  }

  async addAudienceSubscribers(subscribers: { email: string; name?: string }[]) {
    return this.request<{ added: number; skipped: number }>('v1/audience/subscribers', {
      body: { subscribers },
      method: 'POST',
    })
  }

  /** Records a verified one-click opt-out; requires a service scope. */
  async unsubscribeAudienceMember(email: string) {
    return this.request<{ unsubscribed: boolean }>('v1/audience/unsubscribe', {
      body: { email },
      method: 'POST',
    })
  }

  async listAuditDrains() {
    return this.request<{ drains: BackendAuditDrain[] }>('v1/audit-drains')
  }

  async createAuditDrain(input: BackendAuditDrainInput, audit?: BackendAuditRequest) {
    return this.request<{ drain: BackendAuditDrain }>('v1/audit-drains', {
      body: input,
      headers: auditRequestHeaders(audit),
      method: 'POST',
    })
  }

  async deleteAuditDrain(id: string, audit?: BackendAuditRequest) {
    return this.request<{ deleted: true }>(`v1/audit-drains/${encodeURIComponent(id)}`, {
      headers: auditRequestHeaders(audit),
      method: 'DELETE',
    })
  }

  async getAuditRetention() {
    return this.request<BackendAuditRetention>('v1/audit-retention')
  }

  async updateAuditRetention(input: BackendAuditRetention, audit?: BackendAuditRequest) {
    return this.request<BackendAuditRetention>('v1/audit-retention', {
      body: input,
      headers: auditRequestHeaders(audit),
      method: 'PUT',
    })
  }

  /** Facade-only: resolves a source app before its webhook signature is verified. */
  async getWebhookSource(sourceAppId: string) {
    return this.request<BackendWebhookSource>(
      `v1/internal/source-apps/${encodeURIComponent(sourceAppId)}/webhook`
    )
  }

  async ingestSourceRelease(input: BackendSourceReleaseInput) {
    return this.request<{ created: boolean; releaseId: string }>('v1/source-releases', {
      body: input,
      method: 'POST',
    })
  }

  async collectSourceChange(input: BackendSourceChangeInput) {
    return this.request<{ changeId: string; created: boolean }>('v1/source-changes', {
      body: input,
      method: 'POST',
    })
  }

  async ingestDeployment(input: BackendDeploymentInput) {
    return this.request<{ created: boolean; deploymentId: string }>('v1/source-deployments', {
      body: input,
      method: 'POST',
    })
  }

  /** Begins connecting a GitHub App installation; the state is single-use. */
  async startGitHubConnection() {
    return this.request<{ state: string }>('v1/github/connections/start', { method: 'POST' })
  }

  async completeGitHubConnection(input: { code: string; installationId: number; state: string }) {
    return this.request<GitHubConnection>('v1/github/connections/complete', {
      body: input,
      method: 'POST',
    })
  }

  async listGitHubConnections() {
    return this.request<{ connections: GitHubConnection[] }>('v1/github/connections')
  }

  async deleteGitHubConnection(connectionId: string) {
    return this.request<{ deleted: true }>(
      `v1/github/connections/${encodeURIComponent(connectionId)}`,
      { method: 'DELETE' }
    )
  }

  async listGitHubRepositories(connectionId: string) {
    return this.request<{ repositories: GitHubRepository[] }>(
      `v1/github/connections/${encodeURIComponent(connectionId)}/repositories`
    )
  }

  /** Facade-only: every workspace's source for a repository an installation delivers. */
  async getGitHubSources(installationId: number, repositoryId: number) {
    return this.request<{ sources: BackendWebhookSource[] }>(
      `v1/internal/github/installations/${installationId}/repositories/${repositoryId}/sources`
    )
  }

  /** Facade-only: records an installation from GitHub's lifecycle events. */
  async recordGitHubInstallation(installationId: number, input: GitHubInstallationRecord) {
    return this.request<{ recorded: true }>(`v1/internal/github/installations/${installationId}`, {
      body: input,
      method: 'PUT',
    })
  }

  /** Facade-only: records a suspension, resumption, or removal. */
  async setGitHubInstallationStatus(
    installationId: number,
    status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  ) {
    return this.request<{ archived: number }>(
      `v1/internal/github/installations/${installationId}/status`,
      { body: { status }, method: 'POST' }
    )
  }

  /** Facade-only: archives sources for repositories an installation lost. */
  async removeGitHubRepositories(installationId: number, repositoryIds: string[]) {
    return this.request<{ archived: number }>(
      `v1/internal/github/installations/${installationId}/removed-repositories`,
      { body: { repositoryIds }, method: 'POST' }
    )
  }

  /** Facade-only: returns a dead-lettered outbox event to the queue. */
  async replayOutboxEvent(eventId: string) {
    return this.request<{ replayed: true }>(
      `v1/internal/outbox-events/${encodeURIComponent(eventId)}/replay`,
      { method: 'POST' }
    )
  }

  /** Facade-only: applies a billing event once, at the version it expects. */
  async syncWorkspaceEntitlement(input: BackendEntitlementSync) {
    return this.request<{ replayed: boolean; version: number }>(
      'v1/internal/billing/entitlements',
      { body: input, method: 'POST' }
    )
  }

  /** Facade-only: adds a paid AI credit pack once per provider reference. */
  async grantWorkspaceCredits(input: BackendCreditGrant) {
    return this.request<{ balance: number; replayed: boolean }>(
      'v1/internal/billing/credit-grants',
      { body: input, method: 'POST' }
    )
  }

  /** The owner's contract view; requires a fresh two-factor session. */
  async getWorkspaceEntitlement() {
    return this.request<{ entitlement: BackendWorkspaceEntitlement }>('v1/entitlements/contract')
  }

  async getLaunchCampaign(campaignId: string) {
    return this.request<BackendLaunchCampaign>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}`
    )
  }

  async getLaunchBrand() {
    return this.request<{ kit: BrandKit | null; profile: BrandProfile | null }>('v1/launch/brand')
  }

  async getLaunchPreferences() {
    return this.request<BackendLaunchPreferences>('v1/launch/preferences')
  }

  async listLaunchSpecs(releaseId: string) {
    return this.request<{ specs: BackendLaunchSpec[] }>(
      `v1/launch/releases/${encodeURIComponent(releaseId)}/specs`
    )
  }

  async getLaunchSpec(specId: string) {
    return this.request<BackendLaunchSpec>(`v1/launch/specs/${encodeURIComponent(specId)}`)
  }

  async saveLaunchSpec(
    releaseId: string,
    input: BackendLaunchVersionInput & { sources: unknown[] }
  ) {
    return this.request<BackendLaunchSpec>(
      `v1/launch/releases/${encodeURIComponent(releaseId)}/specs`,
      { body: input, method: 'POST' }
    )
  }

  async approveLaunchSpec(specId: string) {
    return this.request<BackendLaunchSpec>(
      `v1/launch/specs/${encodeURIComponent(specId)}/approve`,
      { method: 'POST' }
    )
  }

  async listLaunchPlans(campaignId: string) {
    return this.request<{ plans: BackendLaunchPlan[] }>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/plans`
    )
  }

  async getLaunchPlan(campaignId: string, planId: string) {
    return this.request<BackendLaunchPlan>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/plans/${encodeURIComponent(planId)}`
    )
  }

  async saveLaunchPlan(
    campaignId: string,
    input: BackendLaunchVersionInput & { specId: string | null }
  ) {
    return this.request<BackendLaunchPlan>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/plans`,
      { body: input, method: 'POST' }
    )
  }

  async approveLaunchPlan(planId: string) {
    return this.request<BackendLaunchPlan>(
      `v1/launch/plans/${encodeURIComponent(planId)}/approve`,
      { method: 'POST' }
    )
  }

  async saveLaunchPosts(campaignId: string, input: BackendLaunchPostsInput) {
    return this.request<{ angleCount: number; postCount: number }>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/posts`,
      { body: input, method: 'POST' }
    )
  }

  async listLaunchRevisions(campaignId: string) {
    return this.request<{ revisions: BackendLaunchRevision[] }>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/revisions`
    )
  }

  async createLaunchRevision(
    campaignId: string,
    input: { comment: string; modelId: string | null; proposal: unknown }
  ) {
    return this.request<BackendLaunchRevision>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/revisions`,
      { body: input, method: 'POST' }
    )
  }

  async getLaunchRevision(revisionId: string) {
    return this.request<BackendLaunchRevision>(
      `v1/launch/revisions/${encodeURIComponent(revisionId)}`
    )
  }

  /** Apply a proposal; design changes carry the patched document by design id. */
  async applyLaunchRevision(
    revisionId: string,
    input: { designDocuments: Record<string, unknown>; related: number[] }
  ) {
    return this.request<{ designIds: string[]; revision: BackendLaunchRevision }>(
      `v1/launch/revisions/${encodeURIComponent(revisionId)}/apply`,
      { body: input, method: 'POST' }
    )
  }

  async discardLaunchRevision(revisionId: string) {
    return this.request<BackendLaunchRevision>(
      `v1/launch/revisions/${encodeURIComponent(revisionId)}/discard`,
      { method: 'POST' }
    )
  }

  async setLaunchDesignCritique(designId: string, critique: Record<string, unknown>) {
    return this.request<{ updated: true }>(
      `v1/launch/designs/${encodeURIComponent(designId)}/critique`,
      { body: { critique }, method: 'PUT' }
    )
  }

  async listLaunchRuns(campaignId: string) {
    return this.request<{ runs: BackendLaunchRun[] }>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/runs`
    )
  }

  async startLaunchRun(campaignId: string, kind: string) {
    return this.request<BackendLaunchRun>(
      `v1/launch/campaigns/${encodeURIComponent(campaignId)}/runs`,
      { body: { kind }, method: 'POST' }
    )
  }

  async getLaunchRun(runId: string) {
    return this.request<BackendLaunchRun>(`v1/launch/runs/${encodeURIComponent(runId)}`)
  }

  /** Ends a running run. The counters are an agent run's totals; omitted ones are kept. */
  async finishLaunchRun(
    runId: string,
    input: {
      costCents?: number
      error?: string
      resultId?: string | null
      status: 'BUDGET_EXHAUSTED' | 'FAILED' | 'SUCCEEDED'
      stepCount?: number
      summary?: string | null
      tokensIn?: number
      tokensOut?: number
    }
  ) {
    return this.request<{ updated: true }>(`v1/launch/runs/${encodeURIComponent(runId)}/finish`, {
      body: input,
      method: 'POST',
    })
  }

  /** Keeps a run's lease; `running` is false once the run was cancelled or expired. */
  async heartbeatLaunchRun(runId: string) {
    return this.request<{ running: boolean }>(
      `v1/launch/runs/${encodeURIComponent(runId)}/heartbeat`,
      { method: 'POST' }
    )
  }

  /** Agent runs end CANCELLED; pipeline runs end FAILED with "Cancelled.". */
  async cancelLaunchRun(runId: string) {
    return this.request<{ cancelled: boolean }>(
      `v1/launch/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' }
    )
  }

  /**
   * Starts an agent or conversation run, optionally about a campaign. Any
   * member starts a conversation run; an agent run needs owner, admin, or
   * creator. Answers 403 when the workspace turned AI off. The member who
   * started a conversation run may append its steps, heartbeat, finish, and
   * cancel it.
   */
  async startAgentRun(input: { campaignId?: string | null; kind: 'agent' | 'conversation' }) {
    return this.request<BackendAgentRun>('v1/launch/runs', { body: input, method: 'POST' })
  }

  async getAgentRun(runId: string) {
    return this.request<BackendAgentRun>(`v1/launch/runs/${encodeURIComponent(runId)}`)
  }

  async appendLaunchRunStep(runId: string, input: BackendLaunchRunStepInput) {
    return this.request<BackendLaunchRunStep>(
      `v1/launch/runs/${encodeURIComponent(runId)}/steps`,
      { body: input, method: 'POST' }
    )
  }

  /** A run's trace in step order, up to 500 steps. */
  async listLaunchRunSteps(runId: string) {
    return this.request<{ steps: BackendLaunchRunStep[] }>(
      `v1/launch/runs/${encodeURIComponent(runId)}/steps`
    )
  }

  /** Any member starts a conversation; an empty title becomes "New conversation". */
  async createConversation(input: { campaignId?: string | null; title?: string }) {
    return this.request<BackendConversation>('v1/conversations', { body: input, method: 'POST' })
  }

  /** Most recently active first; status defaults to ACTIVE, limit to 20 (at most 100). */
  async listConversations(
    options: { campaignId?: string; limit?: number; status?: 'ACTIVE' | 'ARCHIVED' } = {}
  ) {
    const parameters = new URLSearchParams()
    if (options.campaignId) parameters.set('campaignId', options.campaignId)
    if (options.limit !== undefined) parameters.set('limit', String(options.limit))
    if (options.status) parameters.set('status', options.status)
    return this.request<{ conversations: BackendConversation[] }>(`v1/conversations?${parameters}`)
  }

  /** A conversation with its 200 newest messages, oldest first. */
  async getConversation(conversationId: string) {
    return this.request<{
      conversation: BackendConversation
      messages: BackendConversationMessage[]
    }>(`v1/conversations/${encodeURIComponent(conversationId)}`)
  }

  /** Answers 409 for an archived conversation. */
  async appendConversationMessage(conversationId: string, input: BackendConversationMessageInput) {
    return this.request<BackendConversationMessage>(
      `v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      { body: input, method: 'POST' }
    )
  }

  async updateConversation(conversationId: string, input: BackendConversationUpdate) {
    return this.request<BackendConversation>(
      `v1/conversations/${encodeURIComponent(conversationId)}`,
      { body: input, method: 'PATCH' }
    )
  }

  async getCampaignAsset(campaignId: string, assetId: string) {
    return this.request<BackendCampaignAssetLink>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}`
    )
  }

  async linkCampaignAsset(
    campaignId: string,
    assetId: string,
    input: BackendLinkCampaignAssetInput
  ) {
    return this.request<BackendCampaignAssetLink>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}`,
      { body: input, method: 'PUT' }
    )
  }

  /** Append generated angles and draft posts to a campaign. */
  async saveCampaignCopy(
    campaignId: string,
    input: Pick<BackendCreateCampaignInput, 'angles' | 'posts'>
  ) {
    return this.request<{ angleCount: number; postCount: number }>(
      `v1/campaigns/${encodeURIComponent(campaignId)}/copy`,
      { body: input, method: 'POST' }
    )
  }

  /** Edit a design in place; name and variant label change only when given. */
  async replaceDesign(
    id: string,
    input: { document: unknown; name?: string; variantLabel?: string }
  ) {
    return this.request<{ updated: true }>(`v1/designs/${encodeURIComponent(id)}`, {
      body: input,
      method: 'PUT',
    })
  }

  async getBootstrap() {
    return this.request<BackendBootstrapSnapshot>('v1/bootstrap')
  }

  async listAuditLogs(
    query: AuditLogQuery,
    audit?: { ipHash?: string; userAgentSummary?: string }
  ) {
    const parameters = new URLSearchParams()
    if (query.action) parameters.set('action', query.action)
    if (query.actorUserId) parameters.set('actorUserId', query.actorUserId)
    if (query.cursor) parameters.set('cursor', query.cursor)
    if (query.endDate) parameters.set('endDate', query.endDate.toISOString())
    if (query.entityType) parameters.set('entityType', query.entityType)
    if (query.limit !== undefined) parameters.set('limit', String(query.limit))
    if (query.outcome) parameters.set('outcome', query.outcome)
    if (query.search) parameters.set('search', query.search)
    if (query.startDate) parameters.set('startDate', query.startDate.toISOString())
    return this.request<AuditLogPage>(`v1/audit-logs?${parameters}`, {
      headers: {
        ...(audit?.ipHash ? { 'x-audit-ip-hash': audit.ipHash } : {}),
        ...(audit?.userAgentSummary
          ? { 'x-audit-user-agent-summary': audit.userAgentSummary }
          : {}),
      },
    })
  }

  async setActiveWorkspace(organizationId: string) {
    return this.request<{ updated: true }>('v1/workspaces/active', {
      body: { organizationId },
      method: 'POST',
    })
  }

  async getWorkspace() {
    return this.request<{ workspace: Workspace | null }>('v1/workspace')
  }

  async updateWorkspace(input: UpdateWorkspaceInput) {
    return this.request<WorkspaceMutation>('v1/workspace', { body: input, method: 'PATCH' })
  }

  async listWorkspaceMembers() {
    return this.request<{ members: WorkspaceMember[] }>('v1/workspace/members')
  }

  async listWorkspaceInvitations() {
    return this.request<{ invitations: WorkspaceInvitation[] }>('v1/workspace/invitations')
  }

  async inviteWorkspaceMember(input: { email: string; role: string }) {
    return this.request<WorkspaceInvitationDetail>('v1/workspace/invitations', {
      body: input,
      method: 'POST',
    })
  }

  async resendWorkspaceInvitation(invitationId: string) {
    return this.request<WorkspaceInvitationDetail>(
      `v1/workspace/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: 'POST' }
    )
  }

  async revokeWorkspaceInvitation(invitationId: string) {
    return this.request<{ id: string; status: 'canceled' }>(
      `v1/workspace/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' }
    )
  }

  async updateWorkspaceMemberRole(memberId: string, role: string) {
    return this.request<WorkspaceMember>(`v1/workspace/members/${encodeURIComponent(memberId)}`, {
      body: { role },
      method: 'PATCH',
    })
  }

  async removeWorkspaceMember(memberId: string) {
    return this.request<{ removed: true }>(`v1/workspace/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    })
  }

  async leaveWorkspace() {
    return this.request<{ left: true }>('v1/workspace/leave', { method: 'POST' })
  }

  async transferWorkspaceOwnership(memberId: string) {
    return this.request<{ transferred: true }>('v1/workspace/transfer-ownership', {
      body: { memberId },
      method: 'POST',
    })
  }

  async requestWorkspaceDeletion(confirmation: string) {
    return this.request<WorkspaceDeletion>('v1/workspace/deletion', {
      body: { confirmation },
      method: 'POST',
    })
  }

  async cancelWorkspaceDeletion() {
    return this.request<WorkspaceDeletion>('v1/workspaces/deletion/cancel', { method: 'POST' })
  }
}
