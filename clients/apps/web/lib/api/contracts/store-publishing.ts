import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'

/**
 * Contracts for sending store screenshots to App Store Connect and Google
 * Play. Credentials are write-only: responses never include secrets.
 */

/** Store publishing providers. */
export const storeProviderSchema = z.enum(['APP_STORE_CONNECT', 'GOOGLE_PLAY'])

/** One {@link storeProviderSchema} value. */
export type StoreProvider = z.infer<typeof storeProviderSchema>

/** A credential without its secret. */
export const credentialSummarySchema = z.object({
  id: z.string(),
  provider: storeProviderSchema,
  label: z.string(),
  metadata: z.record(z.string(), z.string()),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
})

/** One {@link credentialSummarySchema} value. */
export type CredentialSummary = z.infer<typeof credentialSummarySchema>

/** `GET /api/store-screenshots/publishing/credentials` */
export const listCredentialsContract = defineContract({
  method: 'GET',
  name: 'store-publishing.list-credentials',
  output: z.object({ credentials: z.array(credentialSummarySchema), configured: z.boolean() }),
  path: '/api/store-screenshots/publishing/credentials',
  summary: 'List store publishing credentials',
})

/** `POST /api/store-screenshots/publishing/credentials` request. */
export const addCredentialRequestSchema = z.object({
  provider: storeProviderSchema,
  label: z.string().trim().min(1).max(80),
  /** The .p8 key text or the service account JSON. Sent once, encrypted at rest. */
  secret: z.string().min(50).max(12_000),
  issuerId: z.string().max(80).optional(),
  keyId: z.string().max(40).optional(),
})

/** `POST /api/store-screenshots/publishing/credentials` */
export const addCredentialContract = defineContract({
  body: addCredentialRequestSchema,
  method: 'POST',
  name: 'store-publishing.add-credential',
  output: credentialSummarySchema,
  path: '/api/store-screenshots/publishing/credentials',
  status: 201,
  summary: 'Store an App Store Connect key or Google Play service account',
})

/** `DELETE /api/store-screenshots/publishing/credentials/{credentialId}` */
export const deleteCredentialContract = defineContract({
  method: 'DELETE',
  name: 'store-publishing.delete-credential',
  output: z.object({ deleted: z.boolean() }),
  params: z.object({ credentialId: z.string().regex(/^[a-z0-9]{10,32}$/) }),
  path: '/api/store-screenshots/publishing/credentials/{credentialId}',
  summary: 'Delete a store publishing credential',
})

/** `POST /api/store-screenshots/publishing/app-store/browse` request. */
export const ascBrowseRequestSchema = z.object({
  credentialId: z.string().regex(/^[a-z0-9]{10,32}$/),
  appId: z.string().max(40).optional(),
  versionId: z.string().max(60).optional(),
})

/** `POST /api/store-screenshots/publishing/app-store/browse` */
export const ascBrowseContract = defineContract({
  body: ascBrowseRequestSchema,
  method: 'POST',
  name: 'store-publishing.asc-browse',
  output: z.object({
    apps: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          bundleId: z.string(),
          primaryLocale: z.string(),
        })
      )
      .optional(),
    versions: z
      .array(
        z.object({
          id: z.string(),
          versionString: z.string(),
          platform: z.string(),
          appStoreState: z.string(),
          editable: z.boolean(),
        })
      )
      .optional(),
    localizations: z.array(z.object({ id: z.string(), locale: z.string() })).optional(),
  }),
  path: '/api/store-screenshots/publishing/app-store/browse',
  summary: 'List apps, versions, or localizations in App Store Connect',
})

/** The output of {@link ascBrowseContract}. */
export type AscBrowseResult = z.infer<typeof ascBrowseContract.output>

/** One screenshot to upload, as base64 PNG or JPEG. */
export const uploadImageSchema = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  image: z.string().min(100).max(16_000_000),
})

/** `POST /api/store-screenshots/publishing/app-store/upload` request. */
export const ascUploadRequestSchema = uploadImageSchema.extend({
  credentialId: z.string().regex(/^[a-z0-9]{10,32}$/),
  localizationId: z.string().min(1).max(60),
  displayType: z.string().regex(/^APP_[A-Z0-9_]+$/),
  /** Delete the set's existing screenshots first (send on the first file of each set only). */
  clearFirst: z.boolean(),
})

/** `POST /api/store-screenshots/publishing/app-store/upload` */
export const ascUploadContract = defineContract({
  body: ascUploadRequestSchema,
  method: 'POST',
  name: 'store-publishing.asc-upload',
  output: z.object({ id: z.string(), state: z.string().nullable() }),
  path: '/api/store-screenshots/publishing/app-store/upload',
  summary: 'Upload one screenshot to App Store Connect (does not submit for review)',
})

/** Google Play actions. */
export const playActionSchema = z.enum(['start', 'upload', 'commit'])

/** `POST /api/store-screenshots/publishing/google-play` request. */
export const playRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    credentialId: z.string().regex(/^[a-z0-9]{10,32}$/),
    packageName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/),
  }),
  uploadImageSchema.extend({
    action: z.literal('upload'),
    credentialId: z.string().regex(/^[a-z0-9]{10,32}$/),
    packageName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/),
    editId: z.string().min(1).max(100),
    language: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/),
    imageType: z.enum(['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots']),
    clearFirst: z.boolean(),
  }),
  z.object({
    action: z.literal('commit'),
    credentialId: z.string().regex(/^[a-z0-9]{10,32}$/),
    packageName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/),
    editId: z.string().min(1).max(100),
    /** The user confirmed that committing changes the live store listing. */
    confirmed: z.literal(true),
  }),
])

/** `POST /api/store-screenshots/publishing/google-play` */
export const playContract = defineContract({
  body: playRequestSchema,
  method: 'POST',
  name: 'store-publishing.google-play',
  output: z.object({
    editId: z.string().optional(),
    imageId: z.string().optional(),
    committed: z.boolean().optional(),
  }),
  path: '/api/store-screenshots/publishing/google-play',
  summary: 'Upload listing screenshots to a Google Play edit, then commit it explicitly',
})
