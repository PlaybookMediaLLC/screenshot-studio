import { z } from 'zod'
import type {
  AccountDeletionStatus,
  ExperimentState,
  SocialAccount,
  SocialSet,
  SocialSetList,
  UserPreferences,
  Webhook,
  WebhookDelivery,
  WritingSample,
} from 'screenshot-studio-backend-sdk'
import { defineContract, mirrors } from '@/lib/api/contract'
import { contentDraftIdSchema } from '@/lib/api/contracts/content-drafts'

/**
 * The settings platform (RFC 043): a person's preferences, experiments and
 * account deletion; social sets with their accounts, schedules, defaults,
 * public profiles and Writing Assistant; and outbound webhooks. Each schema
 * mirrors the backend SDK's type, so the Go contract and this one cannot drift.
 */

/** An ISO 8601 instant, as the backend wrote it. */
export const isoInstantSchema = z.string()

/** Light, dark, or the operating system's choice. */
export const themeSchema = z.enum(['light', 'dark', 'system'])

/** How the desktop navigation shows. */
export const navigationLayoutSchema = z.enum(['compact', 'dynamic', 'expanded'])

/** The first day of a calendar week. */
export const weekStartSchema = z.enum(['monday', 'sunday'])

/** The direction text runs in the editor. */
export const textDirectionSchema = z.enum(['ltr', 'rtl'])

/** A person's preferences. */
export const userPreferencesSchema = mirrors<UserPreferences>()(
  z.object({
    developerMode: z.boolean(),
    dismissedTips: z.array(z.string()),
    emailNotifications: z.boolean(),
    experiments: z.record(z.string(), z.boolean()),
    navigation: navigationLayoutSchema,
    showScrollbars: z.boolean(),
    textDirection: textDirectionSchema,
    theme: themeSchema,
    timeZone: z.string().nullable(),
    updatedAt: isoInstantSchema.nullable(),
    version: z.number().int(),
    weekStart: weekStartSchema,
  })
)

/** A help tip's ID. */
export const helpTipIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

/** A preferences save: only the fields set change. */
export const userPreferencesUpdateSchema = z
  .object({
    baseVersion: z.number().int().min(1).optional(),
    developerMode: z.boolean().optional(),
    dismissTip: helpTipIdSchema.optional(),
    emailNotifications: z.boolean().optional(),
    experiments: z.record(z.string().max(64), z.boolean()).optional(),
    navigation: navigationLayoutSchema.optional(),
    resetTips: z.boolean().optional(),
    showScrollbars: z.boolean().optional(),
    textDirection: textDirectionSchema.optional(),
    theme: themeSchema.optional(),
    /** An IANA zone such as `Europe/Paris`, or an empty string to follow the browser. */
    timeZone: z.string().max(64).optional(),
    weekStart: weekStartSchema.optional(),
  })
  .strict()

/** `GET /api/v1/me/preferences` */
export const getUserPreferencesContract = defineContract({
  method: 'GET',
  name: 'me.preferences',
  output: userPreferencesSchema,
  path: '/api/v1/me/preferences',
  summary: 'Read your preferences',
})

/** `PATCH /api/v1/me/preferences` */
export const updateUserPreferencesContract = defineContract({
  body: userPreferencesUpdateSchema,
  method: 'PATCH',
  name: 'me.preferences-update',
  output: userPreferencesSchema,
  path: '/api/v1/me/preferences',
  summary: 'Save your preferences',
})

/** An experiment as you see it in this workspace. */
export const experimentStateSchema = mirrors<ExperimentState>()(
  z.object({
    dependencies: z.array(z.string()),
    description: z.string(),
    disabledByAdmin: z.boolean(),
    enabled: z.boolean(),
    enforcement: z.string(),
    entitled: z.boolean(),
    entitlement: z.string(),
    id: z.string(),
    minAppVersion: z.string(),
    name: z.string(),
    optedIn: z.boolean(),
    status: z.enum(['experimental', 'available', 'promoted', 'unavailable']),
    userEditable: z.boolean(),
  })
)

/** The experiment registry, evaluated for you. */
export const experimentListSchema = z.object({ items: z.array(experimentStateSchema) })

/** `GET /api/v1/experiments` */
export const listExperimentsContract = defineContract({
  method: 'GET',
  name: 'experiments.list',
  output: experimentListSchema,
  path: '/api/v1/experiments',
  summary: 'List experiments',
})

/** Path parameters naming one experiment. */
export const experimentParamsSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/) })

/** `PUT /api/v1/experiments/{id}/workspace` */
export const setWorkspaceExperimentContract = defineContract({
  body: z.object({ disabled: z.boolean() }).strict(),
  method: 'PUT',
  name: 'experiments.workspace',
  output: experimentListSchema,
  params: experimentParamsSchema,
  path: '/api/v1/experiments/{id}/workspace',
  summary: 'Turn an experiment off, or back on, for the workspace',
})

/** Your open account deletion request and what blocks one. */
export const accountDeletionStatusSchema = mirrors<AccountDeletionStatus>()(
  z.object({
    blockers: z.array(
      z.object({
        code: z.enum(['owns_workspace']),
        message: z.string(),
        workspaceId: z.string(),
        workspaceName: z.string(),
      })
    ),
    request: z
      .object({
        executeAfter: isoInstantSchema,
        id: z.string(),
        requestedAt: isoInstantSchema,
        status: z.enum(['REQUESTED', 'CANCELLED', 'COMPLETED']),
      })
      .nullable(),
  })
)

/** `GET /api/v1/me/account-deletion` */
export const getAccountDeletionContract = defineContract({
  method: 'GET',
  name: 'me.account-deletion',
  output: accountDeletionStatusSchema,
  path: '/api/v1/me/account-deletion',
  summary: 'Read your account deletion request',
})

/** `POST /api/v1/me/account-deletion` */
export const requestAccountDeletionContract = defineContract({
  body: z.object({ confirmation: z.string().min(1).max(320) }).strict(),
  method: 'POST',
  name: 'me.account-deletion-request',
  output: accountDeletionStatusSchema,
  path: '/api/v1/me/account-deletion',
  status: 202,
  summary: 'Request deletion of your account',
})

/** `DELETE /api/v1/me/account-deletion` */
export const cancelAccountDeletionContract = defineContract({
  method: 'DELETE',
  name: 'me.account-deletion-cancel',
  output: accountDeletionStatusSchema,
  path: '/api/v1/me/account-deletion',
  summary: 'Cancel your account deletion request',
})

/** An account's health, read from the social service. */
export const socialAccountHealthSchema = z.enum([
  'connected',
  'reconnect_required',
  'expired',
  'revoked',
  'removed',
  'permission_required',
])

/** A connected account in a social set. */
export const socialAccountSchema = mirrors<SocialAccount>()(
  z.object({
    avatarUrl: z.string().nullable(),
    createdAt: isoInstantSchema,
    displayName: z.string().nullable(),
    handle: z.string().nullable(),
    health: socialAccountHealthSchema,
    id: z.string(),
    platform: z.string(),
    socialSetId: z.string().nullable(),
  })
)

/** One X follow-up a new draft starts with. */
export const engagementRuleSchema = z.object({
  atLikes: z.number().int().min(0).max(1_000_000),
  enabled: z.boolean(),
  text: z.string().max(1_000).optional(),
})

/** A set's default X follow-ups. */
export const engagementSchema = z.object({
  autoPlug: engagementRuleSchema,
  autoRepost: engagementRuleSchema,
})

/** A draft platform a default or guidance can name. */
export const draftPlatformSchema = z.enum([
  'x',
  'linkedin',
  'instagram',
  'instagram-standalone',
  'threads',
  'bluesky',
  'mastodon',
])

/** How a set writes; it refines the workspace brand voice. */
export const styleGuideSchema = z.object({
  audience: z.string().max(300),
  endings: z.array(z.string().max(280)).max(10),
  formatting: z.string().max(600),
  openings: z.array(z.string().max(280)).max(10),
  platformGuidance: z.record(z.string(), z.string().max(600)),
  prohibitedPhrases: z.array(z.string().max(80)).max(30),
  terminology: z.array(z.string().max(80)).max(30),
  tone: z.string().max(300),
})

/** A Writing Assistant's lifecycle. */
export const writingAssistantStatusSchema = z.enum([
  'not_configured',
  'in_progress',
  'configured',
  'disabled',
  'attention',
])

/** A weekly posting slot: a weekday (0 is Sunday) and a time as HH:MM. */
export const weeklySlotSchema = z.object({
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  weekday: z.number().int().min(0).max(6),
})

/** Shared with the workspace, or private to its owner. */
export const socialSetVisibilitySchema = z.enum(['WORKSPACE', 'PRIVATE'])

/** A publishing identity. */
export const socialSetSchema = mirrors<SocialSet>()(
  z.object({
    accounts: z.array(socialAccountSchema),
    color: z.string(),
    createdAt: isoInstantSchema,
    defaultPlatforms: z.array(z.string()),
    engagementDefaults: engagementSchema,
    id: z.string(),
    isOwner: z.boolean(),
    name: z.string(),
    naturalPostingTimes: z.boolean(),
    needsAttention: z.boolean(),
    ownerUserId: z.string().nullable(),
    postingSlots: z.array(weeklySlotSchema),
    primaryPlatform: z.string().nullable(),
    publicProfile: z.boolean(),
    publicSlug: z.string(),
    timeZone: z.string(),
    updatedAt: isoInstantSchema,
    version: z.number().int(),
    visibility: socialSetVisibilitySchema,
    weeklySlotCount: z.number().int(),
    writingAssistant: z.object({
      configuredAt: isoInstantSchema.nullable(),
      sampleCount: z.number().int(),
      status: writingAssistantStatusSchema,
      styleGuide: styleGuideSchema,
    }),
  })
)

/** The sets you see, accounts in no set, and private sets left behind. */
export const socialSetListSchema = mirrors<SocialSetList>()(
  z.object({
    items: z.array(socialSetSchema),
    orphaned: z.array(
      z.object({ accountCount: z.number().int(), id: z.string(), name: z.string() })
    ),
    unassigned: z.array(socialAccountSchema),
  })
)

/** Path parameters naming one set. */
export const socialSetParamsSchema = z.object({ id: contentDraftIdSchema })

/** Path parameters naming one account of one set. */
export const socialSetAccountParamsSchema = z.object({
  connectionId: contentDraftIdSchema,
  id: contentDraftIdSchema,
})

/** `GET /api/v1/social-sets` */
export const listSocialSetsContract = defineContract({
  method: 'GET',
  name: 'social-sets.list',
  output: socialSetListSchema,
  path: '/api/v1/social-sets',
  summary: 'List your social sets',
})

/** `POST /api/v1/social-sets` */
export const createSocialSetContract = defineContract({
  body: z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      name: z.string().trim().min(1).max(80),
      timeZone: z.string().max(64).optional(),
      visibility: socialSetVisibilitySchema.optional(),
    })
    .strict(),
  method: 'POST',
  name: 'social-sets.create',
  output: socialSetSchema,
  path: '/api/v1/social-sets',
  status: 201,
  summary: 'Create a social set',
})

/** `GET /api/v1/social-sets/{id}` */
export const getSocialSetContract = defineContract({
  method: 'GET',
  name: 'social-sets.get',
  output: socialSetSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}',
  summary: 'Read a social set',
})

/** A set's settings save, based on the version you read. */
export const socialSetUpdateSchema = z
  .object({
    baseVersion: z.number().int().min(1),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    defaultPlatforms: z.array(draftPlatformSchema).max(10).optional(),
    engagementDefaults: engagementSchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    naturalPostingTimes: z.boolean().optional(),
    postingSlots: z.array(weeklySlotSchema).max(50).optional(),
    primaryPlatform: z.union([draftPlatformSchema, z.literal('')]).optional(),
    publicProfile: z.boolean().optional(),
    timeZone: z.string().max(64).optional(),
  })
  .strict()

/** `PATCH /api/v1/social-sets/{id}` */
export const updateSocialSetContract = defineContract({
  body: socialSetUpdateSchema,
  method: 'PATCH',
  name: 'social-sets.update',
  output: socialSetSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}',
  summary: 'Save a social set',
})

/** What removing an account or deleting a set did. */
export const socialSetRemovalSchema = z.object({
  cancelledPostIds: z.array(z.string()),
  draftsArchived: z.number().int(),
})

/** `DELETE /api/v1/social-sets/{id}` */
export const deleteSocialSetContract = defineContract({
  body: z.object({ confirmation: z.string().min(1).max(80) }).strict(),
  method: 'DELETE',
  name: 'social-sets.delete',
  output: socialSetRemovalSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}',
  summary: 'Delete a social set',
})

/** `POST /api/v1/social-sets/{id}/share` */
export const shareSocialSetContract = defineContract({
  method: 'POST',
  name: 'social-sets.share',
  output: socialSetSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/share',
  summary: 'Share a private social set with the workspace',
})

/** `POST /api/v1/social-sets/{id}/accounts/{connectionId}` */
export const assignSocialSetAccountContract = defineContract({
  method: 'POST',
  name: 'social-sets.account-add',
  output: socialSetSchema,
  params: socialSetAccountParamsSchema,
  path: '/api/v1/social-sets/{id}/accounts/{connectionId}',
  summary: 'Add an account that is in no set to a social set',
})

/** `DELETE /api/v1/social-sets/{id}/accounts/{connectionId}` */
export const removeSocialSetAccountContract = defineContract({
  method: 'DELETE',
  name: 'social-sets.account-remove',
  output: socialSetRemovalSchema,
  params: socialSetAccountParamsSchema,
  path: '/api/v1/social-sets/{id}/accounts/{connectionId}',
  summary: 'Remove an account from a social set',
})

/** A set of another of your workspaces. */
export const copyableSocialSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
})

/** `GET /api/v1/social-sets/copyable` */
export const listCopyableSocialSetsContract = defineContract({
  method: 'GET',
  name: 'social-sets.copyable',
  output: z.object({ items: z.array(copyableSocialSetSchema) }),
  path: '/api/v1/social-sets/copyable',
  summary: 'List social sets of your other workspaces',
})

/** `POST /api/v1/social-sets/copy` */
export const copySocialSetContract = defineContract({
  body: z
    .object({ socialSetId: contentDraftIdSchema, workspaceId: z.string().min(1).max(64) })
    .strict(),
  method: 'POST',
  name: 'social-sets.copy',
  output: socialSetSchema,
  path: '/api/v1/social-sets/copy',
  status: 201,
  summary: "Copy another workspace's social set here, without its accounts",
})

/** `PUT /api/v1/social-sets/{id}/writing-assistant` */
export const updateWritingAssistantContract = defineContract({
  body: z
    .object({
      action: z.enum(['create', 'disable', 'enable']).optional(),
      baseVersion: z.number().int().min(1),
      styleGuide: styleGuideSchema.optional(),
    })
    .strict(),
  method: 'PUT',
  name: 'social-sets.writing-assistant',
  output: socialSetSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/writing-assistant',
  summary: "Save a social set's Writing Assistant",
})

/** One writing sample. */
export const writingSampleSchema = mirrors<WritingSample>()(
  z.object({
    createdAt: isoInstantSchema,
    createdByUserId: z.string().nullable(),
    id: z.string(),
    source: z.enum(['manual', 'draft']),
    sourceDraftId: z.string().nullable(),
    text: z.string(),
  })
)

/** `GET /api/v1/social-sets/{id}/writing-samples` */
export const listWritingSamplesContract = defineContract({
  method: 'GET',
  name: 'social-sets.writing-samples',
  output: z.object({ items: z.array(writingSampleSchema) }),
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/writing-samples',
  summary: "List a social set's writing samples",
})

/** `POST /api/v1/social-sets/{id}/writing-samples` */
export const addWritingSampleContract = defineContract({
  body: z.union([
    z.object({ text: z.string().trim().min(1).max(5_000) }).strict(),
    z.object({ draftId: contentDraftIdSchema }).strict(),
  ]),
  method: 'POST',
  name: 'social-sets.writing-sample-add',
  output: writingSampleSchema,
  params: socialSetParamsSchema,
  path: '/api/v1/social-sets/{id}/writing-samples',
  status: 201,
  summary: 'Add a writing sample, written here or imported from a draft of the set',
})

/** `DELETE /api/v1/social-sets/{id}/writing-samples/{sampleId}` */
export const deleteWritingSampleContract = defineContract({
  method: 'DELETE',
  name: 'social-sets.writing-sample-delete',
  output: z.object({ deleted: z.literal(true) }),
  params: socialSetParamsSchema.extend({ sampleId: contentDraftIdSchema }),
  path: '/api/v1/social-sets/{id}/writing-samples/{sampleId}',
  summary: 'Remove a writing sample',
})

/** A webhook event a subscription can choose. */
export const webhookEventSchema = z.enum([
  'draft.created',
  'draft.published',
  'draft.scheduled',
  'draft.planned',
  'draft.status_changed',
  'draft.tags_changed',
  'draft.deleted',
])

/** An outbound webhook, without its secret. */
export const webhookSchema = mirrors<Webhook>()(
  z.object({
    createdAt: isoInstantSchema,
    enabled: z.boolean(),
    events: z.array(z.string()),
    id: z.string(),
    lastFailureAt: isoInstantSchema.nullable(),
    lastSuccessAt: isoInstantSchema.nullable(),
    name: z.string(),
    previousSecretExpiresAt: isoInstantSchema.nullable(),
    updatedAt: isoInstantSchema,
    url: z.string(),
  })
)

/** A webhook just made or rotated, with its secret, shown this once. */
export const webhookWithSecretSchema = z.object({ secret: z.string(), webhook: webhookSchema })

/** Path parameters naming one webhook. */
export const webhookParamsSchema = z.object({ id: contentDraftIdSchema })

/** `GET /api/v1/webhooks` */
export const listWebhooksContract = defineContract({
  method: 'GET',
  name: 'webhooks.list',
  output: z.object({ events: z.array(z.string()), items: z.array(webhookSchema) }),
  path: '/api/v1/webhooks',
  summary: "List the workspace's outbound webhooks",
})

/** `POST /api/v1/webhooks` */
export const createWebhookContract = defineContract({
  body: z
    .object({
      events: z.array(webhookEventSchema).min(1).max(7),
      name: z.string().trim().min(1).max(80),
      url: z.url({ protocol: /^https$/ }).max(2_048),
    })
    .strict(),
  method: 'POST',
  name: 'webhooks.create',
  output: webhookWithSecretSchema,
  path: '/api/v1/webhooks',
  status: 201,
  summary: 'Add an outbound webhook',
})

/** `PATCH /api/v1/webhooks/{id}` */
export const updateWebhookContract = defineContract({
  body: z
    .object({
      enabled: z.boolean().optional(),
      events: z.array(webhookEventSchema).min(1).max(7).optional(),
      name: z.string().trim().min(1).max(80).optional(),
      url: z
        .url({ protocol: /^https$/ })
        .max(2_048)
        .optional(),
    })
    .strict(),
  method: 'PATCH',
  name: 'webhooks.update',
  output: webhookSchema,
  params: webhookParamsSchema,
  path: '/api/v1/webhooks/{id}',
  summary: 'Change an outbound webhook',
})

/** `DELETE /api/v1/webhooks/{id}` */
export const deleteWebhookContract = defineContract({
  method: 'DELETE',
  name: 'webhooks.delete',
  output: z.object({ deleted: z.literal(true) }),
  params: webhookParamsSchema,
  path: '/api/v1/webhooks/{id}',
  summary: 'Delete an outbound webhook',
})

/** `POST /api/v1/webhooks/{id}/rotate` */
export const rotateWebhookSecretContract = defineContract({
  method: 'POST',
  name: 'webhooks.rotate',
  output: webhookWithSecretSchema,
  params: webhookParamsSchema,
  path: '/api/v1/webhooks/{id}/rotate',
  summary: "Rotate a webhook's signing secret",
})

/** One event owed to a webhook, and its attempts. */
export const webhookDeliverySchema = mirrors<WebhookDelivery>()(
  z.object({
    attempts: z.number().int(),
    createdAt: isoInstantSchema,
    errorClass: z.string().nullable(),
    eventId: z.string(),
    eventType: z.string(),
    history: z.array(
      z.object({
        attemptNumber: z.number().int(),
        durationMs: z.number().int(),
        errorClass: z.string().nullable(),
        outcome: z.enum(['SUCCEEDED', 'FAILED']),
        responseStatus: z.number().int().nullable(),
        startedAt: isoInstantSchema,
      })
    ),
    id: z.string(),
    lastAttemptAt: isoInstantSchema.nullable(),
    manual: z.boolean(),
    nextAttemptAt: isoInstantSchema.nullable(),
    responseStatus: z.number().int().nullable(),
    status: z.enum(['PENDING', 'SENDING', 'SUCCEEDED', 'DEAD']),
  })
)

/** `POST /api/v1/webhooks/{id}/test` */
export const testWebhookContract = defineContract({
  method: 'POST',
  name: 'webhooks.test',
  output: webhookDeliverySchema,
  params: webhookParamsSchema,
  path: '/api/v1/webhooks/{id}/test',
  status: 202,
  summary: 'Send a test delivery',
})

/** `GET /api/v1/webhooks/{id}/deliveries` */
export const listWebhookDeliveriesContract = defineContract({
  method: 'GET',
  name: 'webhooks.deliveries',
  output: z.object({ items: z.array(webhookDeliverySchema) }),
  params: webhookParamsSchema,
  path: '/api/v1/webhooks/{id}/deliveries',
  summary: "List a webhook's recent deliveries",
})

/** `POST /api/v1/webhook-deliveries/{id}/retry` */
export const retryWebhookDeliveryContract = defineContract({
  method: 'POST',
  name: 'webhooks.delivery-retry',
  output: webhookDeliverySchema,
  params: z.object({ id: z.string().regex(/^[a-z0-9]{10,32}$/) }),
  path: '/api/v1/webhook-deliveries/{id}/retry',
  status: 202,
  summary: 'Replay a delivery that stopped retrying',
})
