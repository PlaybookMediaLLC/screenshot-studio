import 'server-only'

import { createPrivateKey, randomUUID } from 'node:crypto'
import type { StoreProvider } from '@/lib/api/contracts/store-publishing'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, storeBackend, type StoreReviewPayload } from '@/lib/backend/sdk'
import {
  ascCredentialsSchema,
  deleteScreenshot,
  ensureScreenshotSet,
  listApps,
  listAppStoreVersions,
  listVersionLocalizations,
  uploadScreenshot,
  type AscCredentials,
  type AscDisplayType,
} from '@/lib/integrations/app-store-connect'
import {
  createEdit,
  commitEdit,
  deleteAllImages,
  playCredentialsSchema,
  uploadImage,
  type GooglePlayCredentials,
  type PlayImageMime,
  type PlayImageType,
} from '@/lib/integrations/google-play'
import { decryptStoreCredential, encryptStoreCredential } from './store-credential-crypto'
import { createStoreReviewToken, verifyStoreReviewToken } from './store-review-token'

/**
 * Server-side store screenshot features: shareable reviews and store
 * uploads. Reviews hold rendered slides only (stored as export assets),
 * never source screenshots. Credentials are encrypted here before they
 * reach the backend and decrypted only for the request that uses them.
 */

/** A request was refused for a reason the user can fix. */
export class StoreScreenshotsError extends Error {
  /** HTTP status to report. */
  readonly status: 400 | 403 | 404 | 409 | 429 | 503

  /** Create an error. */
  constructor(message: string, status: StoreScreenshotsError['status']) {
    super(message)
    this.name = 'StoreScreenshotsError'
    this.status = status
  }
}

/** Store one rendered review slide (JPEG) and return its asset id. */
export async function storeReviewImage(
  tenant: TenantContext,
  input: { bytes: Uint8Array; width: number; height: number; name: string }
): Promise<string> {
  if (input.bytes[0] !== 0xff || input.bytes[1] !== 0xd8)
    throw new StoreScreenshotsError('Review images must be JPEG.', 400)
  const asset = await backendSDK(tenant).storeGeneratedAsset({
    body: input.bytes,
    classification: 'export',
    contentType: 'image/jpeg',
    fileName: `${input.name.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 60) || 'slide'}.jpg`,
    height: input.height,
    width: input.width,
  })
  return asset.id
}

function withLink(review: StoreReviewPayload, organizationId: string, origin: string) {
  const token = createStoreReviewToken({
    reviewId: review.id,
    organizationId,
    shareTokenId: review.shareTokenId,
  })
  const { shareTokenId: _shareTokenId, ...rest } = review
  return { ...rest, url: review.revokedAt ? null : `${origin}/review/${token}` }
}

/** Create a review from uploaded slide assets. */
export async function createReview(
  tenant: TenantContext,
  input: Parameters<ReturnType<typeof storeBackend>['createStoreReview']>[0],
  origin: string
) {
  const review = await storeBackend(tenant).createStoreReview(input)
  return withLink(review, tenant.organizationId, origin)
}

/** Reviews of a project with their links and comments. */
export async function listReviews(tenant: TenantContext, projectId: string, origin: string) {
  const { reviews } = await storeBackend(tenant).listStoreReviews(projectId)
  return reviews.map((review) => withLink(review, tenant.organizationId, origin))
}

/** Turn off a review link. */
export async function revokeReview(tenant: TenantContext, reviewId: string) {
  await storeBackend(tenant).revokeStoreReview(reviewId)
}

/** Resolve or reopen a comment. */
export async function resolveReviewComment(
  tenant: TenantContext,
  reviewId: string,
  commentId: string,
  resolved: boolean
) {
  await storeBackend(tenant).resolveStoreReviewComment(reviewId, commentId, resolved)
}

function linkTenant(organizationId: string): TenantContext {
  return {
    organizationId,
    principal: { kind: 'trigger_service', organizationId, taskRunId: 'store-review-link' },
    requestId: randomUUID(),
  }
}

/**
 * Open a review by link. Slide images are returned as short-lived signed
 * URLs; nothing else from the workspace is exposed.
 */
export async function readSharedReview(token: string) {
  const claim = verifyStoreReviewToken(token)
  if (!claim) return null
  const tenant = linkTenant(claim.organizationId)
  try {
    const review = await storeBackend(tenant).getSharedStoreReview(
      claim.reviewId,
      claim.shareTokenId
    )
    const sdk = backendSDK(tenant)
    const slides = await Promise.all(
      review.slides.map(async (slide) => ({
        ...slide,
        url: (await sdk.signAssetDownload(slide.assetId)).downloadUrl,
      }))
    )
    return {
      id: review.id,
      name: review.name,
      versionLabel: review.versionLabel,
      projectRevision: review.projectRevision,
      createdAt: review.createdAt,
      slides: slides.map(({ assetId: _assetId, ...slide }) => slide),
      comments: review.comments,
    }
  } catch {
    return null
  }
}

/** Add a comment through a review link. */
export async function commentOnSharedReview(
  token: string,
  input: { slideId: string; x: number | null; y: number | null; authorName: string; body: string }
) {
  const claim = verifyStoreReviewToken(token)
  if (!claim) throw new StoreScreenshotsError('This review link is not valid.', 404)
  return storeBackend(linkTenant(claim.organizationId)).addStoreReviewComment(
    claim.reviewId,
    input,
    claim.shareTokenId
  )
}

/** Store a credential after checking it can actually sign requests. */
export async function addPublishingCredential(
  tenant: TenantContext,
  input: {
    provider: StoreProvider
    label: string
    secret: string
    issuerId?: string
    keyId?: string
  }
) {
  let metadata: Record<string, string>
  let secret: string
  if (input.provider === 'APP_STORE_CONNECT') {
    if (!input.issuerId || !input.keyId)
      throw new StoreScreenshotsError('Enter the issuer ID and key ID.', 400)
    try {
      createPrivateKey(input.secret)
    } catch {
      throw new StoreScreenshotsError('The .p8 file is not a valid private key.', 400)
    }
    metadata = { issuerId: input.issuerId, keyId: input.keyId }
    secret = JSON.stringify(
      ascCredentialsSchema.parse({
        issuerId: input.issuerId,
        keyId: input.keyId,
        privateKeyPem: input.secret,
      })
    )
  } else {
    let parsed: GooglePlayCredentials & { project_id?: string }
    try {
      parsed = playCredentialsSchema
        .extend({ project_id: playCredentialsSchema.shape.client_email.optional() })
        .parse(JSON.parse(input.secret))
      createPrivateKey(parsed.private_key)
    } catch {
      throw new StoreScreenshotsError('Upload the service account JSON key from Google Cloud.', 400)
    }
    metadata = {
      clientEmail: parsed.client_email,
      ...(parsed.project_id ? { projectId: parsed.project_id } : {}),
    }
    secret = JSON.stringify({
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      token_uri: parsed.token_uri,
    })
  }
  return storeBackend(tenant).createStorePublishingCredential({
    provider: input.provider,
    label: input.label,
    metadata,
    encryptedSecret: encryptStoreCredential(secret),
  })
}

/** Credentials without secrets. */
export async function listPublishingCredentials(tenant: TenantContext) {
  return (await storeBackend(tenant).listStorePublishingCredentials()).credentials
}

/** Delete a credential. */
export async function deletePublishingCredential(tenant: TenantContext, id: string) {
  await storeBackend(tenant).deleteStorePublishingCredential(id)
}

async function credentials(tenant: TenantContext, id: string) {
  const record = await storeBackend(tenant).getStorePublishingCredentialSecret(id)
  const secret = JSON.parse(decryptStoreCredential(record.encryptedSecret)) as unknown
  return record.provider === 'APP_STORE_CONNECT'
    ? { provider: record.provider, asc: ascCredentialsSchema.parse(secret) as AscCredentials }
    : {
        provider: record.provider,
        play: playCredentialsSchema.parse(secret) as GooglePlayCredentials,
      }
}

async function ascCredentials(tenant: TenantContext, id: string): Promise<AscCredentials> {
  const result = await credentials(tenant, id)
  if (!('asc' in result) || !result.asc)
    throw new StoreScreenshotsError('Choose an App Store Connect key.', 400)
  return result.asc
}

async function playCredentials(tenant: TenantContext, id: string): Promise<GooglePlayCredentials> {
  const result = await credentials(tenant, id)
  if (!('play' in result) || !result.play)
    throw new StoreScreenshotsError('Choose a Google Play service account.', 400)
  return result.play
}

/** Apps, versions, and localizations visible to an App Store Connect key. */
export async function browseAppStore(
  tenant: TenantContext,
  credentialId: string,
  appId?: string,
  versionId?: string
) {
  const creds = await ascCredentials(tenant, credentialId)
  if (versionId) return { localizations: await listVersionLocalizations(creds, versionId) }
  if (appId) return { versions: await listAppStoreVersions(creds, appId) }
  return { apps: await listApps(creds) }
}

/** Upload one screenshot into a localization's screenshot set (first call may clear it). Never submits for review. */
export async function uploadToAppStore(
  tenant: TenantContext,
  input: {
    credentialId: string
    localizationId: string
    displayType: AscDisplayType
    fileName: string
    bytes: Uint8Array
    clearFirst: boolean
  }
) {
  const creds = await ascCredentials(tenant, input.credentialId)
  const set = await ensureScreenshotSet(creds, input.localizationId, input.displayType)
  if (input.clearFirst)
    for (const screenshot of set.screenshots) await deleteScreenshot(creds, screenshot.id)
  return uploadScreenshot(creds, set.id, { fileName: input.fileName, bytes: input.bytes })
}

/** Start a Google Play edit. Nothing is visible on the listing until the edit is committed. */
export async function startPlayEdit(
  tenant: TenantContext,
  credentialId: string,
  packageName: string
) {
  return createEdit(await playCredentials(tenant, credentialId), packageName)
}

/** Replace one language's images of one type inside an edit (first call clears, later calls add). */
export async function uploadToPlay(
  tenant: TenantContext,
  input: {
    credentialId: string
    packageName: string
    editId: string
    language: string
    imageType: PlayImageType
    clearFirst: boolean
    bytes: Uint8Array
    mime: PlayImageMime
  }
) {
  const creds = await playCredentials(tenant, input.credentialId)
  if (input.clearFirst)
    await deleteAllImages(creds, input.packageName, input.editId, input.language, input.imageType)
  return uploadImage(
    creds,
    input.packageName,
    input.editId,
    input.language,
    input.imageType,
    input.bytes,
    input.mime
  )
}

/**
 * Commit a Google Play edit, publishing the new listing images. This is a
 * separate, explicit action: uploads alone never change the live listing.
 */
export async function commitPlayEdit(
  tenant: TenantContext,
  credentialId: string,
  packageName: string,
  editId: string
) {
  return commitEdit(await playCredentials(tenant, credentialId), packageName, editId)
}
