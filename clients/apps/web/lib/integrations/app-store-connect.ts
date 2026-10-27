import 'server-only'
import { createHash, createSign } from 'node:crypto'
import { z } from 'zod'
import type { FetchLike } from './figma'

/**
 * App Store Connect API client for screenshot uploads. It reads apps,
 * versions, localizations, and screenshot sets, and uploads screenshots
 * through Apple's reserve, upload, commit flow. It never submits a version
 * for review; that stays a manual step in App Store Connect.
 */

const API = 'https://api.appstoreconnect.apple.com/v1'
const TOKEN_TTL_SECONDS = 1200
const MAX_ATTEMPTS = 3
const MAX_RETRY_WAIT_MS = 60_000

/** An App Store Connect API key: issuer ID, key ID, and the ES256 `.p8` private key. */
export const ascCredentialsSchema = z.object({
  issuerId: z.string().min(1),
  keyId: z.string().min(1),
  privateKeyPem: z.string().min(1),
})

/** An App Store Connect API key. */
export type AscCredentials = z.infer<typeof ascCredentialsSchema>

/** Injectable network, clock, and wait, so tests run without the network or real delays. */
export type AscOptions = {
  /** Fetch implementation. Defaults to the global fetch. */
  fetch?: FetchLike
  /** Wait between retries. Defaults to a timer. */
  sleep?: (ms: number) => Promise<void>
  /** Current time in milliseconds. Defaults to `Date.now`. */
  now?: () => number
}

/** Failure categories a caller can act on. */
export const ascErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'rate-limited',
  'invalid',
  'unavailable',
])

/** One {@link ascErrorCodeSchema} value. */
export type AscErrorCode = z.infer<typeof ascErrorCodeSchema>

const MESSAGES: Record<AscErrorCode, string> = {
  unauthorized: 'App Store Connect rejected the API key. Check the issuer ID, key ID, and .p8 key.',
  forbidden: 'This API key cannot access that resource. Use an Admin or App Manager key.',
  'not-found': 'App Store Connect could not find that resource.',
  conflict: 'App Store Connect refused the change in the current state.',
  'rate-limited': 'App Store Connect is rate limiting requests. Try again in a minute.',
  invalid: 'App Store Connect rejected the request.',
  unavailable: 'App Store Connect is not responding. Try again later.',
}

/** An App Store Connect request failed. The message is safe to show and never contains credentials. */
export class AppStoreConnectError extends Error {
  /** HTTP status from Apple, 503 when Apple could not be reached, 502 for an unreadable answer. */
  readonly status: number
  /** Failure category. */
  readonly code: AscErrorCode

  /** Create an App Store Connect error. */
  constructor(message: string, status: number, code: AscErrorCode) {
    super(message)
    this.name = 'AppStoreConnectError'
    this.status = status
    this.code = code
  }
}

/** Apple `screenshotDisplayType` values this product exports. */
export const ascDisplayTypeSchema = z.enum([
  'APP_IPHONE_67',
  'APP_IPHONE_65',
  'APP_IPHONE_61',
  'APP_IPHONE_55',
  'APP_IPAD_PRO_3GEN_129',
  'APP_IPAD_PRO_3GEN_11',
  'APP_DESKTOP',
  'APP_WATCH_ULTRA',
  'APP_APPLE_VISION_PRO',
])

/** One {@link ascDisplayTypeSchema} value. */
export type AscDisplayType = z.infer<typeof ascDisplayTypeSchema>

/** Apple screenshot display type for each export target id. */
export const ASC_DISPLAY_TYPES = {
  'ios-iphone-6.9': 'APP_IPHONE_67',
  'ios-iphone-6.5': 'APP_IPHONE_65',
  'ios-iphone-6.3': 'APP_IPHONE_61',
  'ios-iphone-5.5': 'APP_IPHONE_55',
  'ios-ipad-13': 'APP_IPAD_PRO_3GEN_129',
  'ios-ipad-11': 'APP_IPAD_PRO_3GEN_11',
  mac: 'APP_DESKTOP',
  'apple-watch-ultra': 'APP_WATCH_ULTRA',
  'apple-vision-pro': 'APP_APPLE_VISION_PRO',
} as const satisfies Record<string, AscDisplayType>

/** Version states {@link listAppStoreVersions} returns. */
export const ascVersionStateSchema = z.enum([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'READY_FOR_SALE',
])

/** One {@link ascVersionStateSchema} value. */
export type AscVersionState = z.infer<typeof ascVersionStateSchema>

/** Version states whose screenshots Apple lets you change. */
export const ascEditableVersionStateSchema = ascVersionStateSchema.extract([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
])

/** Apple's processing state for an uploaded screenshot. */
export const ascAssetStateSchema = z.enum([
  'AWAITING_UPLOAD',
  'UPLOAD_COMPLETE',
  'COMPLETE',
  'FAILED',
])

/** One {@link ascAssetStateSchema} value. */
export type AscAssetState = z.infer<typeof ascAssetStateSchema>

const appSchema = z
  .object({
    id: z.string(),
    attributes: z.object({ name: z.string(), bundleId: z.string(), primaryLocale: z.string() }),
  })
  .transform(({ id, attributes }) => ({ id, ...attributes }))

/** An app the API key can see. */
export type AscApp = z.output<typeof appSchema>

const versionSchema = z
  .object({
    id: z.string(),
    attributes: z.object({
      versionString: z.string(),
      platform: z.string(),
      // Apple is replacing appStoreState with appVersionState; read whichever is present.
      appStoreState: z.string().optional(),
      appVersionState: z.string().optional(),
    }),
  })
  .transform(({ id, attributes }) => {
    const state = attributes.appStoreState ?? attributes.appVersionState ?? 'UNKNOWN'
    return {
      id,
      versionString: attributes.versionString,
      platform: attributes.platform,
      appStoreState: state,
      editable: ascEditableVersionStateSchema.safeParse(state).success,
    }
  })

/** An App Store version; `editable` is true when its screenshots can change. */
export type AscVersion = z.output<typeof versionSchema>

const localizationSchema = z
  .object({ id: z.string(), attributes: z.object({ locale: z.string() }) })
  .transform(({ id, attributes }) => ({ id, locale: attributes.locale }))

/** One locale of an App Store version. */
export type AscLocalization = z.output<typeof localizationSchema>

const screenshotSchema = z
  .object({
    type: z.literal('appScreenshots'),
    id: z.string(),
    attributes: z.object({
      fileName: z.string().nullish(),
      sourceFileChecksum: z.string().nullish(),
      assetDeliveryState: z.object({ state: ascAssetStateSchema.nullish().catch(null) }).nullish(),
    }),
  })
  .transform(({ id, attributes }) => ({
    id,
    fileName: attributes.fileName ?? null,
    checksum: attributes.sourceFileChecksum ?? null,
    state: attributes.assetDeliveryState?.state ?? null,
  }))

/** A screenshot in a set; `checksum` is the MD5 Apple recorded at commit. */
export type AscScreenshot = z.output<typeof screenshotSchema>

const setSchema = z.object({
  id: z.string(),
  attributes: z.object({ screenshotDisplayType: z.string() }),
  relationships: z
    .object({
      appScreenshots: z.object({ data: z.array(z.object({ id: z.string() })).nullish() }).nullish(),
    })
    .nullish(),
})

/** A screenshot set for one display type, with its screenshots in display order. */
export type AscScreenshotSet = { id: string; displayType: string; screenshots: AscScreenshot[] }

/** The outcome of {@link uploadScreenshot}. */
export type AscUploadResult = { id: string; state: AscAssetState | null }

const reservationSchema = z.object({
  data: z.object({
    id: z.string(),
    attributes: z.object({
      uploadOperations: z
        .array(
          z.object({
            method: z.string(),
            url: z.string(),
            offset: z.number(),
            length: z.number(),
            requestHeaders: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
          })
        )
        .nullish(),
    }),
  }),
})

const appleErrorSchema = z.object({ errors: z.array(z.object({ detail: z.string().optional() })) })

/** Every app the API key can see, following pagination. */
export async function listApps(creds: AscCredentials, options: AscOptions = {}): Promise<AscApp[]> {
  return (await listAll(creds, options, '/apps?limit=200', appSchema)).data
}

/** Versions of an app in states that matter for screenshots, newest first as Apple orders them. */
export async function listAppStoreVersions(
  creds: AscCredentials,
  appId: string,
  options: AscOptions = {}
): Promise<AscVersion[]> {
  const states = ascVersionStateSchema.options.join(',')
  const path = `/apps/${encodeURIComponent(appId)}/appStoreVersions?filter[appStoreState]=${states}&limit=50`
  return (await listAll(creds, options, path, versionSchema)).data
}

/** The locales of an App Store version. */
export async function listVersionLocalizations(
  creds: AscCredentials,
  versionId: string,
  options: AscOptions = {}
): Promise<AscLocalization[]> {
  const path = `/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=200`
  return (await listAll(creds, options, path, localizationSchema)).data
}

/** The screenshot sets of a version localization, with their screenshots. */
export async function listScreenshotSets(
  creds: AscCredentials,
  localizationId: string,
  options: AscOptions = {}
): Promise<AscScreenshotSet[]> {
  const path = `/appStoreVersionLocalizations/${encodeURIComponent(localizationId)}/appScreenshotSets?include=appScreenshots&limit=50&limit[appScreenshots]=50`
  const { data, included } = await listAll(creds, options, path, setSchema)
  const screenshots = new Map<string, AscScreenshot>()
  for (const item of included) {
    const screenshot = screenshotSchema.safeParse(item)
    if (screenshot.success) screenshots.set(screenshot.data.id, screenshot.data)
  }
  return data.map((set) => ({
    id: set.id,
    displayType: set.attributes.screenshotDisplayType,
    screenshots: (set.relationships?.appScreenshots?.data ?? []).flatMap(
      ({ id }) => screenshots.get(id) ?? []
    ),
  }))
}

/** The localization's screenshot set for a display type, created when it does not exist yet. */
export async function ensureScreenshotSet(
  creds: AscCredentials,
  localizationId: string,
  displayType: AscDisplayType,
  options: AscOptions = {}
): Promise<AscScreenshotSet> {
  const sets = await listScreenshotSets(creds, localizationId, options)
  const existing = sets.find((set) => set.displayType === displayType)
  if (existing) return existing
  const body = {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: localizationId },
        },
      },
    },
  }
  const created = parse(
    z.object({ data: setSchema }),
    await call(creds, options, 'POST', '/appScreenshotSets', body)
  )
  return { id: created.data.id, displayType, screenshots: [] }
}

/**
 * Upload one screenshot into a set: reserve, send the bytes to Apple's
 * upload operations, then commit with the MD5 checksum. A screenshot with
 * the same file name and checksum that already finished uploading is
 * returned as is. A failed upload deletes its reservation so it does not
 * hold one of the set's ten slots.
 */
export async function uploadScreenshot(
  creds: AscCredentials,
  setId: string,
  file: { fileName: string; bytes: Uint8Array },
  options: AscOptions = {}
): Promise<AscUploadResult> {
  const checksum = createHash('md5').update(file.bytes).digest('hex')
  const listPath = `/appScreenshotSets/${encodeURIComponent(setId)}/appScreenshots?limit=50`
  const { data: existing } = await listAll(creds, options, listPath, screenshotSchema)
  const done = existing.find(
    (shot) =>
      shot.fileName === file.fileName &&
      shot.checksum === checksum &&
      (shot.state === 'COMPLETE' || shot.state === 'UPLOAD_COMPLETE')
  )
  if (done) return { id: done.id, state: done.state }

  const reserve = {
    data: {
      type: 'appScreenshots',
      attributes: { fileName: file.fileName, fileSize: file.bytes.byteLength },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
    },
  }
  // No retry after any 4xx, 429 included: a duplicate reservation would hold one of the set's ten slots.
  const reserved = parse(
    reservationSchema,
    await call(creds, options, 'POST', '/appScreenshots', reserve, false)
  )
  const { id, attributes } = reserved.data
  try {
    for (const operation of attributes.uploadOperations ?? []) {
      const headers = Object.fromEntries(
        (operation.requestHeaders ?? []).map((h) => [h.name, h.value])
      )
      const body = file.bytes.slice(operation.offset, operation.offset + operation.length)
      const response = await send(options, operation.url, {
        method: operation.method,
        headers,
        body,
      })
      if (!response.ok) throw await failureFrom(response)
    }
    const commit = {
      data: {
        type: 'appScreenshots',
        id,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    }
    const path = `/appScreenshots/${encodeURIComponent(id)}`
    const committed = parse(
      z.object({ data: screenshotSchema }),
      await call(creds, options, 'PATCH', path, commit)
    )
    return { id, state: committed.data.state }
  } catch (error) {
    await deleteScreenshot(creds, id, options).catch(() => undefined)
    throw error
  }
}

/** Delete a screenshot from its set. */
export async function deleteScreenshot(
  creds: AscCredentials,
  screenshotId: string,
  options: AscOptions = {}
): Promise<void> {
  await call(creds, options, 'DELETE', `/appScreenshots/${encodeURIComponent(screenshotId)}`)
}

/** Set the display order of a set's screenshots. `ids` must list every screenshot in the set. */
export async function reorderScreenshots(
  creds: AscCredentials,
  setId: string,
  ids: string[],
  options: AscOptions = {}
): Promise<void> {
  const body = { data: ids.map((id) => ({ type: 'appScreenshots', id })) }
  await call(
    creds,
    options,
    'PATCH',
    `/appScreenshotSets/${encodeURIComponent(setId)}/relationships/appScreenshots`,
    body
  )
}

async function listAll<T extends z.ZodType>(
  creds: AscCredentials,
  options: AscOptions,
  path: string,
  item: T
): Promise<{ data: z.output<T>[]; included: unknown[] }> {
  const page = z.object({
    data: z.array(item),
    included: z.array(z.unknown()).optional(),
    links: z.object({ next: z.string().optional() }).optional(),
  })
  const data: z.output<T>[] = []
  const included: unknown[] = []
  let url: string | undefined = `${API}${path}`
  while (url) {
    const body: z.output<typeof page> = parse(page, await call(creds, options, 'GET', url))
    data.push(...body.data)
    included.push(...(body.included ?? []))
    url = body.links?.next
    // The bearer token only ever goes to Apple's API host.
    if (url && !url.startsWith(`${API}/`)) throw unreadable()
  }
  return { data, included }
}

async function call(
  creds: AscCredentials,
  options: AscOptions,
  method: string,
  pathOrUrl: string,
  body?: unknown,
  retryRateLimited = true
): Promise<unknown> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${API}${pathOrUrl}`
  const headers: Record<string, string> = {
    authorization: `Bearer ${token(creds, (options.now ?? Date.now)())}`,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }
  const response = await send(options, url, init, retryRateLimited)
  if (!response.ok) throw await failureFrom(response)
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** Fetch with retries for 429, 5xx, and network failures. Returns the last response. */
async function send(
  options: AscOptions,
  url: string,
  init: RequestInit,
  retryRateLimited = true
): Promise<Response> {
  const fetcher = options.fetch ?? fetch
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(60_000) }).catch(
      () => null
    )
    const retryable =
      !response || response.status >= 500 || (response.status === 429 && retryRateLimited)
    if (response && (!retryable || attempt === MAX_ATTEMPTS)) return response
    if (attempt === MAX_ATTEMPTS) throw failure(503)
    await (options.sleep ?? wait)(retryDelay(response, attempt, (options.now ?? Date.now)()))
  }
}

function retryDelay(response: Response | null, attempt: number, now: number): number {
  const header = response?.headers.get('retry-after')
  const fallback = 1000 * 2 ** (attempt - 1)
  if (!header) return fallback
  const seconds = Number(header)
  const at = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(header)
  return Number.isFinite(at) ? Math.min(Math.max(0, at - now), MAX_RETRY_WAIT_MS) : fallback
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function token(creds: AscCredentials, now: number): string {
  const iat = Math.floor(now / 1000)
  const header = encode({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' })
  const payload = encode({
    iss: creds.issuerId,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    aud: 'appstoreconnect-v1',
  })
  try {
    const signature = createSign('SHA256')
      .update(`${header}.${payload}`)
      .sign({ key: creds.privateKeyPem, dsaEncoding: 'ieee-p1363' })
    return `${header}.${payload}.${signature.toString('base64url')}`
  } catch {
    throw failure(401)
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function errorCode(status: number): AscErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limited'
  return status < 500 ? 'invalid' : 'unavailable'
}

function failure(status: number, detail?: string): AppStoreConnectError {
  const code = errorCode(status)
  const message = detail ? `${MESSAGES[code]} Apple says: ${detail.slice(0, 500)}` : MESSAGES[code]
  return new AppStoreConnectError(message, status, code)
}

/** Map a failed response. Apple's `errors[0].detail` describes the request, never the token. */
async function failureFrom(response: Response): Promise<AppStoreConnectError> {
  if (response.status >= 500) return failure(response.status)
  const body = appleErrorSchema.safeParse(await response.json().catch(() => null))
  return failure(response.status, body.success ? body.data.errors[0]?.detail : undefined)
}

function unreadable(): AppStoreConnectError {
  return new AppStoreConnectError(
    'App Store Connect returned a response this client does not understand.',
    502,
    'unavailable'
  )
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw unreadable()
  return result.data
}
