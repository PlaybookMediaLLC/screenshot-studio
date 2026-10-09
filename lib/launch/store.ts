import 'server-only'

import { Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { AuditMetadata } from '@/lib/audit/metadata'
import type { AuditAction } from '@/lib/audit/types'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import {
  type DesignChanges,
  definedChanges,
  designDocumentSchema,
  patchDesignDocument,
} from '@/lib/design/document'
import { type BrandKitValues, parseBrandKit } from './brand'
import type { PreferenceExamples } from './preferences-format'
import {
  type CampaignPlanContent,
  campaignPlanSchema,
  type LaunchPost,
  postRevisionSchema,
  type ReleaseSpecContent,
  releaseSpecSchema,
  type RevisionChange,
  type RevisionProposal,
  type SpecSectionKey,
  specSectionSchemas,
  type SpecSource,
} from './spec-schema'

/**
 * Persistence for the launch pipeline: versioned specs and plans, AI revision
 * proposals, and posts with provenance. Every read is scoped to one workspace
 * and every write is audited in the same transaction.
 */

export class LaunchError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 | 503
  ) {
    super(message)
    this.name = 'LaunchError'
  }
}

export type ArtifactOrigin = 'ai' | 'human' | 'revision'

function userId(tenant: TenantContext): string | null {
  return tenant.principal.kind === 'session' ? tenant.principal.userId : null
}

/** Audit metadata is flat: drop undefined values and anything that is not a primitive. */
function flatMetadata(metadata: Record<string, unknown>): AuditMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, boolean | null | number | string] =>
        entry[1] === null || ['boolean', 'number', 'string'].includes(typeof entry[1])
    )
  )
}

async function audit(
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  action: AuditAction,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {}
) {
  await appendAuditLog(transaction, {
    action,
    actor: getAuditActor(tenant.principal),
    entityId,
    entityType,
    metadata: flatMetadata(metadata),
    organizationId: tenant.organizationId,
    requestId: tenant.requestId,
  })
}

// ------------------------------------------------------------- context --

export async function loadLaunchCampaign(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    include: { productSurface: true, release: true },
    where: { id: campaignId, organizationId },
  })
  if (!campaign) throw new LaunchError('Campaign not found.', 404)
  return campaign
}

export type LaunchCampaign = Awaited<ReturnType<typeof loadLaunchCampaign>>

export function releaseSourceUrls(campaign: LaunchCampaign): string[] {
  const urls = campaign.release?.sourceUrls
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : []
}

export type ActiveBrand = {
  kit: BrandKitValues | null
  profile: Awaited<ReturnType<typeof prisma.brandProfile.findUnique>>
}

/** The newest active brand kit and the workspace's brand voice. */
export async function getActiveBrand(organizationId: string): Promise<ActiveBrand> {
  const [kitRow, profile] = await Promise.all([
    prisma.brandKit.findFirst({
      orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }],
      where: { organizationId, status: 'ACTIVE' },
    }),
    prisma.brandProfile.findUnique({ where: { organizationId } }),
  ])
  return { kit: kitRow ? parseBrandKit(kitRow.name, kitRow.definition) : null, profile }
}

// --------------------------------------------------------------- specs --

const specSelect = {
  approvedAt: true,
  changeSummary: true,
  content: true,
  createdAt: true,
  id: true,
  modelId: true,
  origin: true,
  releaseId: true,
  sources: true,
  status: true,
  version: true,
} satisfies Prisma.ReleaseSpecSelect

export type StoredSpec = Omit<
  Prisma.ReleaseSpecGetPayload<{ select: typeof specSelect }>,
  'content' | 'sources'
> & {
  content: ReleaseSpecContent
  sources: SpecSource[]
}

function toSpec(row: Prisma.ReleaseSpecGetPayload<{ select: typeof specSelect }>): StoredSpec {
  return {
    ...row,
    content: releaseSpecSchema.parse(row.content),
    sources: (Array.isArray(row.sources) ? row.sources : []) as SpecSource[],
  }
}

export async function getReleaseSpecs(organizationId: string, releaseId: string) {
  const rows = await prisma.releaseSpec.findMany({
    orderBy: { version: 'desc' },
    select: specSelect,
    take: 30,
    where: { organizationId, releaseId },
  })
  const specs = rows.map(toSpec)
  return {
    approved: specs.find((spec) => spec.status === 'APPROVED') ?? null,
    latest: specs[0] ?? null,
    versions: specs.map(({ changeSummary, createdAt, id, origin, status, version }) => ({
      changeSummary,
      createdAt,
      id,
      origin,
      status,
      version,
    })),
  }
}

export async function getSpecById(organizationId: string, specId: string): Promise<StoredSpec> {
  const row = await prisma.releaseSpec.findFirst({
    select: specSelect,
    where: { id: specId, organizationId },
  })
  if (!row) throw new LaunchError('Spec not found.', 404)
  return toSpec(row)
}

/** The spec a campaign should work from: the approved version, else the latest draft. */
export async function getWorkingSpec(
  organizationId: string,
  releaseId: string
): Promise<StoredSpec | null> {
  const { approved, latest } = await getReleaseSpecs(organizationId, releaseId)
  return approved ?? latest
}

export async function saveSpecVersion(
  tenant: TenantContext,
  input: {
    changeSummary: string
    content: ReleaseSpecContent
    metadata?: Record<string, unknown>
    modelId?: string | null
    origin: ArtifactOrigin
    releaseId: string
    sources: SpecSource[]
  }
): Promise<StoredSpec> {
  const content = releaseSpecSchema.parse(input.content)
  return prisma.$transaction(async (transaction) => {
    const release = await transaction.release.findFirst({
      select: { id: true },
      where: { id: input.releaseId, organizationId: tenant.organizationId },
    })
    if (!release) throw new LaunchError('Release not found.', 404)
    const last = await transaction.releaseSpec.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
      where: { releaseId: input.releaseId },
    })
    const row = await transaction.releaseSpec.create({
      data: {
        changeSummary: input.changeSummary.slice(0, 500),
        content,
        createdByUserId: userId(tenant),
        modelId: input.modelId ?? null,
        organizationId: tenant.organizationId,
        origin: input.origin,
        releaseId: input.releaseId,
        sources: input.sources as unknown as Prisma.InputJsonArray,
        version: (last?.version ?? 0) + 1,
      },
      select: specSelect,
    })
    await audit(
      transaction,
      tenant,
      input.origin === 'ai' ? 'product.release_spec_generated' : 'product.release_spec_updated',
      'release_spec',
      row.id,
      {
        flaggedSources: input.sources.filter((source) => source.flagged).length,
        openQuestions: content.openQuestions.length,
        origin: input.origin,
        releaseId: input.releaseId,
        version: row.version,
        ...input.metadata,
      }
    )
    return toSpec(row)
  })
}

export async function approveSpec(tenant: TenantContext, specId: string): Promise<StoredSpec> {
  return prisma.$transaction(async (transaction) => {
    const spec = await transaction.releaseSpec.findFirst({
      select: { id: true, releaseId: true, version: true },
      where: { id: specId, organizationId: tenant.organizationId },
    })
    if (!spec) throw new LaunchError('Spec not found.', 404)
    await transaction.releaseSpec.updateMany({
      data: { status: 'SUPERSEDED' },
      where: { id: { not: spec.id }, releaseId: spec.releaseId, status: 'APPROVED' },
    })
    const row = await transaction.releaseSpec.update({
      data: { approvedAt: new Date(), approvedByUserId: userId(tenant), status: 'APPROVED' },
      select: specSelect,
      where: { id: spec.id },
    })
    await audit(transaction, tenant, 'product.release_spec_approved', 'release_spec', spec.id, {
      version: spec.version,
    })
    return toSpec(row)
  })
}

// --------------------------------------------------------------- plans --

const planSelect = {
  approvedAt: true,
  campaignId: true,
  changeSummary: true,
  content: true,
  createdAt: true,
  id: true,
  modelId: true,
  origin: true,
  specId: true,
  status: true,
  version: true,
} satisfies Prisma.CampaignPlanSelect

export type StoredPlan = Omit<
  Prisma.CampaignPlanGetPayload<{ select: typeof planSelect }>,
  'content'
> & {
  content: CampaignPlanContent
}

function toPlan(row: Prisma.CampaignPlanGetPayload<{ select: typeof planSelect }>): StoredPlan {
  return { ...row, content: campaignPlanSchema.parse(row.content) }
}

export async function getPlanById(
  organizationId: string,
  campaignId: string,
  planId: string
): Promise<StoredPlan> {
  const row = await prisma.campaignPlan.findFirst({
    select: planSelect,
    where: { campaignId, id: planId, organizationId },
  })
  if (!row) throw new LaunchError('Plan not found.', 404)
  return toPlan(row)
}

export async function getCampaignPlans(organizationId: string, campaignId: string) {
  const rows = await prisma.campaignPlan.findMany({
    orderBy: { version: 'desc' },
    select: planSelect,
    take: 30,
    where: { campaignId, organizationId },
  })
  const plans = rows.map(toPlan)
  return {
    approved: plans.find((plan) => plan.status === 'APPROVED') ?? null,
    latest: plans[0] ?? null,
    versions: plans.map(({ changeSummary, createdAt, id, origin, status, version }) => ({
      changeSummary,
      createdAt,
      id,
      origin,
      status,
      version,
    })),
  }
}

export async function getWorkingPlan(
  organizationId: string,
  campaignId: string
): Promise<StoredPlan | null> {
  const { approved, latest } = await getCampaignPlans(organizationId, campaignId)
  return approved ?? latest
}

export async function savePlanVersion(
  tenant: TenantContext,
  input: {
    campaignId: string
    changeSummary: string
    content: CampaignPlanContent
    metadata?: Record<string, unknown>
    modelId?: string | null
    origin: ArtifactOrigin
    specId: string | null
  }
): Promise<StoredPlan> {
  const content = campaignPlanSchema.parse(input.content)
  return prisma.$transaction(async (transaction) => {
    const campaign = await transaction.campaign.findFirst({
      select: { id: true },
      where: { id: input.campaignId, organizationId: tenant.organizationId },
    })
    if (!campaign) throw new LaunchError('Campaign not found.', 404)
    const last = await transaction.campaignPlan.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
      where: { campaignId: input.campaignId },
    })
    const row = await transaction.campaignPlan.create({
      data: {
        campaignId: input.campaignId,
        changeSummary: input.changeSummary.slice(0, 500),
        content,
        createdByUserId: userId(tenant),
        modelId: input.modelId ?? null,
        organizationId: tenant.organizationId,
        origin: input.origin,
        specId: input.specId,
        version: (last?.version ?? 0) + 1,
      },
      select: planSelect,
    })
    await audit(
      transaction,
      tenant,
      input.origin === 'ai' ? 'product.campaign_plan_generated' : 'product.campaign_plan_updated',
      'campaign_plan',
      row.id,
      {
        assets: content.assets.length,
        campaignId: input.campaignId,
        channels: content.channels.length,
        origin: input.origin,
        version: row.version,
        ...input.metadata,
      }
    )
    return toPlan(row)
  })
}

export async function approvePlan(tenant: TenantContext, planId: string): Promise<StoredPlan> {
  return prisma.$transaction(async (transaction) => {
    const plan = await transaction.campaignPlan.findFirst({
      select: { campaignId: true, id: true, version: true },
      where: { id: planId, organizationId: tenant.organizationId },
    })
    if (!plan) throw new LaunchError('Plan not found.', 404)
    await transaction.campaignPlan.updateMany({
      data: { status: 'SUPERSEDED' },
      where: { campaignId: plan.campaignId, id: { not: plan.id }, status: 'APPROVED' },
    })
    const row = await transaction.campaignPlan.update({
      data: { approvedAt: new Date(), approvedByUserId: userId(tenant), status: 'APPROVED' },
      select: planSelect,
      where: { id: plan.id },
    })
    await audit(transaction, tenant, 'product.campaign_plan_approved', 'campaign_plan', plan.id, {
      campaignId: plan.campaignId,
      version: plan.version,
    })
    return toPlan(row)
  })
}

// --------------------------------------------------------------- posts --

/**
 * Save generated copy with its provenance. Plan angles become content angles
 * (appended, so an earlier run's posts keep theirs) and each post records the
 * angle key, phase, spec version, and the spec claims it relies on.
 */
export async function saveLaunchPosts(
  tenant: TenantContext,
  input: {
    angles: CampaignPlanContent['angles']
    campaignId: string
    metadata?: Record<string, unknown>
    planVersion: number
    posts: LaunchPost[]
    specVersion: number
  }
) {
  return prisma.$transaction(async (transaction) => {
    const last = await transaction.contentAngle.findFirst({
      orderBy: { position: 'desc' },
      select: { position: true },
      where: { campaignId: input.campaignId },
    })
    let position = (last?.position ?? -1) + 1
    const angleIds = new Map<string, string>()
    for (const angle of input.angles) {
      if (!input.posts.some((post) => post.angleKey === angle.key)) continue
      const created = await transaction.contentAngle.create({
        data: {
          campaignId: input.campaignId,
          hook: angle.hook,
          organizationId: tenant.organizationId,
          position: position++,
          title: `${angle.key} · ${angle.title}`,
        },
      })
      angleIds.set(angle.key, created.id)
    }
    await transaction.campaignPost.createMany({
      data: input.posts.map((post) => ({
        angleId: angleIds.get(post.angleKey) ?? null,
        callToAction: post.callToAction || null,
        campaignId: input.campaignId,
        channel: post.channel,
        claims: post.claims as Prisma.InputJsonArray,
        copy: post.copy,
        organizationId: tenant.organizationId,
        phase: post.phase,
        planItemKey: post.angleKey,
        planVersion: input.planVersion,
        specVersion: input.specVersion,
        title: post.title || null,
      })),
    })
    await audit(
      transaction,
      tenant,
      'product.campaign_copy_generated',
      'campaign',
      input.campaignId,
      {
        angleCount: angleIds.size,
        channels: [...new Set(input.posts.map((post) => post.channel))].join(','),
        postCount: input.posts.length,
        specVersion: input.specVersion,
        ...input.metadata,
      }
    )
    return { angleCount: angleIds.size, postCount: input.posts.length }
  })
}

// ----------------------------------------------------------- revisions --

const revisionSelect = {
  campaignId: true,
  comment: true,
  createdAt: true,
  decidedAt: true,
  id: true,
  modelId: true,
  proposal: true,
  status: true,
  targetId: true,
  targetKey: true,
  targetType: true,
} satisfies Prisma.CampaignRevisionSelect

export type StoredRevision = Omit<
  Prisma.CampaignRevisionGetPayload<{ select: typeof revisionSelect }>,
  'proposal'
> & {
  proposal: RevisionProposal
}

const toRevision = (
  row: Prisma.CampaignRevisionGetPayload<{ select: typeof revisionSelect }>
): StoredRevision => ({
  ...row,
  proposal: row.proposal as unknown as RevisionProposal,
})

export async function createRevision(
  tenant: TenantContext,
  input: {
    campaignId: string
    comment: string
    modelId: string | null
    proposal: RevisionProposal
  }
): Promise<StoredRevision> {
  return prisma.$transaction(async (transaction) => {
    const row = await transaction.campaignRevision.create({
      data: {
        campaignId: input.campaignId,
        comment: input.comment,
        createdByUserId: userId(tenant),
        modelId: input.modelId,
        organizationId: tenant.organizationId,
        proposal: input.proposal as unknown as Prisma.InputJsonObject,
        targetId: input.proposal.primary.targetId,
        targetKey: input.proposal.primary.targetKey ?? null,
        targetType: input.proposal.primary.targetType,
      },
      select: revisionSelect,
    })
    await audit(
      transaction,
      tenant,
      'product.campaign_revision_proposed',
      'campaign_revision',
      row.id,
      {
        campaignId: input.campaignId,
        related: input.proposal.related.length,
        targetType: input.proposal.primary.targetType,
      }
    )
    return toRevision(row)
  })
}

export async function listRevisions(organizationId: string, campaignId: string) {
  const rows = await prisma.campaignRevision.findMany({
    orderBy: { createdAt: 'desc' },
    select: revisionSelect,
    take: 50,
    where: { campaignId, organizationId },
  })
  return rows.map(toRevision)
}

export async function getRevision(
  organizationId: string,
  revisionId: string
): Promise<StoredRevision> {
  const row = await prisma.campaignRevision.findFirst({
    select: revisionSelect,
    where: { id: revisionId, organizationId },
  })
  if (!row) throw new LaunchError('Revision not found.', 404)
  return toRevision(row)
}

const STALE = 'This changed since the proposal was made. Ask for a new revision.'

async function applyChange(
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  campaignId: string,
  change: RevisionChange,
  comment: string
): Promise<{ designId?: string; specVersions?: { from: number; to: number } }> {
  const organizationId = tenant.organizationId
  if (change.targetType === 'post') {
    const post = await transaction.campaignPost.findFirst({
      where: { campaignId, id: change.targetId, organizationId },
    })
    if (!post) throw new LaunchError('Post not found.', 404)
    const before = change.before as { copy: string }
    if (post.copy !== before.copy) throw new LaunchError(STALE, 409)
    const after = postRevisionSchema.parse(change.after)
    await transaction.campaignPost.update({
      data: {
        callToAction: after.callToAction || null,
        claims: after.claims as Prisma.InputJsonArray,
        copy: after.copy,
        // Revised copy goes back through review.
        ...(post.status === 'NEEDS_CHANGES' || post.status === 'REJECTED'
          ? { status: 'DRAFT' as const }
          : {}),
        title: after.title || null,
      },
      where: { id: post.id },
    })
    return {}
  }
  if (change.targetType === 'spec_section') {
    const spec = await transaction.releaseSpec.findFirst({
      where: { id: change.targetId, organizationId },
    })
    if (!spec) throw new LaunchError('Spec not found.', 404)
    const newer = await transaction.releaseSpec.findFirst({
      select: { id: true },
      where: { releaseId: spec.releaseId, version: { gt: spec.version } },
    })
    if (newer) throw new LaunchError(STALE, 409)
    const section = change.targetKey as SpecSectionKey
    const content = releaseSpecSchema.parse({
      ...releaseSpecSchema.parse(spec.content),
      [section]: specSectionSchemas[section].parse(change.after),
    })
    const created = await transaction.releaseSpec.create({
      data: {
        changeSummary: `Revised ${change.label.toLowerCase()}: ${comment}`.slice(0, 500),
        content,
        createdByUserId: userId(tenant),
        organizationId,
        origin: 'revision',
        releaseId: spec.releaseId,
        sources: spec.sources as Prisma.InputJsonArray,
        version: spec.version + 1,
      },
    })
    await audit(transaction, tenant, 'product.release_spec_updated', 'release_spec', created.id, {
      origin: 'revision',
      section,
      version: created.version,
    })
    return { specVersions: { from: spec.version, to: created.version } }
  }
  if (change.targetType === 'plan') {
    const plan = await transaction.campaignPlan.findFirst({
      where: { campaignId, id: change.targetId, organizationId },
    })
    if (!plan) throw new LaunchError('Plan not found.', 404)
    const newer = await transaction.campaignPlan.findFirst({
      select: { id: true },
      where: { campaignId, version: { gt: plan.version } },
    })
    if (newer) throw new LaunchError(STALE, 409)
    const created = await transaction.campaignPlan.create({
      data: {
        campaignId,
        changeSummary: `Revised: ${comment}`.slice(0, 500),
        content: campaignPlanSchema.parse(change.after),
        createdByUserId: userId(tenant),
        organizationId,
        origin: 'revision',
        specId: plan.specId,
        version: plan.version + 1,
      },
    })
    await audit(transaction, tenant, 'product.campaign_plan_updated', 'campaign_plan', created.id, {
      origin: 'revision',
      version: created.version,
    })
    return {}
  }
  // design
  const design = await transaction.design.findFirst({
    where: { campaignId, id: change.targetId, organizationId },
  })
  if (!design) throw new LaunchError('Design not found.', 404)
  const before = change.before as { updatedAt: string }
  if (design.updatedAt.toISOString() !== before.updatedAt) throw new LaunchError(STALE, 409)
  const after = change.after as { changes: DesignChanges }
  const document = patchDesignDocument(
    designDocumentSchema.parse(design.document),
    definedChanges(after.changes)
  )
  await transaction.design.update({
    // The old render no longer matches; the next render replaces it.
    data: { critique: Prisma.DbNull, document, renderKey: null },
    where: { id: design.id },
  })
  return { designId: design.id }
}

/**
 * After a spec section is revised into a new version, posts move to it when
 * their claims still mean the same thing: posts the reviewer updated with the
 * revision, and posts that cite nothing in the revised section. Posts that
 * cite the revised section and were not updated stay on the version they were
 * written from, so their provenance stays true.
 */
async function movePostsToSpecVersion(
  transaction: Prisma.TransactionClient,
  revision: StoredRevision,
  versions: { from: number; to: number },
  chosen: RevisionChange[]
) {
  const updated = new Set(
    chosen.filter((change) => change.targetType === 'post').map((change) => change.targetId)
  )
  const posts = await transaction.campaignPost.findMany({
    select: { claims: true, id: true },
    where: { campaignId: revision.campaignId, specVersion: versions.from },
  })
  const movable = posts
    .filter(
      (post) =>
        updated.has(post.id) ||
        !(Array.isArray(post.claims) ? (post.claims as Array<{ ref?: string }>) : []).some(
          (claim) => typeof claim.ref === 'string' && claim.ref.split('.')[0] === revision.targetKey
        )
    )
    .map((post) => post.id)
  if (movable.length > 0) {
    await transaction.campaignPost.updateMany({
      data: { specVersion: versions.to },
      where: { id: { in: movable } },
    })
  }
}

/**
 * Apply a proposal: the primary change and the chosen related updates, all or
 * nothing. Returns designs that need a fresh render.
 */
export async function applyRevision(
  tenant: TenantContext,
  revisionId: string,
  relatedIndexes: readonly number[]
): Promise<{ designIds: string[]; revision: StoredRevision }> {
  return prisma.$transaction(async (transaction) => {
    const row = await transaction.campaignRevision.findFirst({
      select: revisionSelect,
      where: { id: revisionId, organizationId: tenant.organizationId },
    })
    if (!row) throw new LaunchError('Revision not found.', 404)
    if (row.status !== 'PROPOSED') throw new LaunchError('This proposal was already decided.', 409)
    const revision = toRevision(row)
    const chosen = relatedIndexes.map((index) => {
      const change = revision.proposal.related[index]
      if (!change) throw new LaunchError('Unknown related change.', 400)
      return change
    })
    const designIds: string[] = []
    let specVersions: { from: number; to: number } | undefined
    for (const change of [revision.proposal.primary, ...chosen]) {
      const result = await applyChange(
        transaction,
        tenant,
        revision.campaignId,
        change,
        revision.comment
      )
      if (result.designId) designIds.push(result.designId)
      if (result.specVersions) specVersions = result.specVersions
    }
    if (specVersions && revision.targetKey) {
      await movePostsToSpecVersion(transaction, revision, specVersions, chosen)
    }
    const updated = await transaction.campaignRevision.update({
      data: { decidedAt: new Date(), decidedByUserId: userId(tenant), status: 'APPLIED' },
      select: revisionSelect,
      where: { id: revision.id },
    })
    await audit(
      transaction,
      tenant,
      'product.campaign_revision_applied',
      'campaign_revision',
      revision.id,
      {
        campaignId: revision.campaignId,
        relatedApplied: chosen.length,
        targetType: revision.targetType,
      }
    )
    return { designIds, revision: toRevision(updated) }
  })
}

export async function discardRevision(
  tenant: TenantContext,
  revisionId: string
): Promise<StoredRevision> {
  return prisma.$transaction(async (transaction) => {
    const row = await transaction.campaignRevision.findFirst({
      select: { id: true, status: true },
      where: { id: revisionId, organizationId: tenant.organizationId },
    })
    if (!row) throw new LaunchError('Revision not found.', 404)
    if (row.status !== 'PROPOSED') throw new LaunchError('This proposal was already decided.', 409)
    const updated = await transaction.campaignRevision.update({
      data: { decidedAt: new Date(), decidedByUserId: userId(tenant), status: 'DISCARDED' },
      select: revisionSelect,
      where: { id: row.id },
    })
    await audit(
      transaction,
      tenant,
      'product.campaign_revision_discarded',
      'campaign_revision',
      row.id
    )
    return toRevision(updated)
  })
}

// ---------------------------------------------------------- preferences --

const plainText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'copy' in value)
    return String((value as { copy: unknown }).copy)
  return ''
}

/** The workspace's review history, newest first, for the preferences block. */
export async function loadPreferenceExamples(organizationId: string): Promise<PreferenceExamples> {
  const [approvedRows, rejectedRows, revisionRows] = await Promise.all([
    prisma.campaignPost.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { channel: true, copy: true, title: true },
      take: 40,
      where: { organizationId, status: { in: ['APPROVED', 'SCHEDULED', 'PUBLISHED'] } },
    }),
    prisma.campaignPost.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { channel: true, copy: true, reviewNote: true, status: true },
      take: 8,
      where: { organizationId, status: { in: ['REJECTED', 'NEEDS_CHANGES'] } },
    }),
    prisma.campaignRevision.findMany({
      orderBy: { decidedAt: 'desc' },
      select: { comment: true, proposal: true, targetType: true },
      take: 8,
      where: { organizationId, status: 'APPLIED' },
    }),
  ])
  const perChannel = new Map<string, number>()
  const approved = approvedRows.filter((post) => {
    const count = perChannel.get(post.channel) ?? 0
    perChannel.set(post.channel, count + 1)
    return count < 2
  })
  return {
    approved: approved.slice(0, 8),
    rejected: rejectedRows.map((post) => ({
      channel: post.channel,
      copy: post.copy,
      note: post.reviewNote,
      status: post.status,
    })),
    revisions: revisionRows.map((revision) => {
      const proposal = revision.proposal as unknown as RevisionProposal | null
      return {
        after: plainText(proposal?.primary.after),
        before: plainText(proposal?.primary.before),
        comment: revision.comment,
        targetType: revision.targetType,
      }
    }),
  }
}
