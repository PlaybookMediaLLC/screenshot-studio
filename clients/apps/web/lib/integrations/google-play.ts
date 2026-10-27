import 'server-only'
import { createHash, createSign } from 'node:crypto'
import { z } from 'zod'
import type { FetchLike } from './figma'

/**
 * Google Play Developer API (androidpublisher v3) client for store listing
 * images. Every change happens inside an edit, and nothing reaches the
 * store until the caller explicitly calls {@link commitEdit}.
 */

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const TOKEN_HOSTS = new Set(['oauth2.googleapis.com', 'accounts.google.com'])
const TOKEN_TTL_SECONDS = 3600
const TOKEN_REFRESH_MARGIN_MS = 60_000
const MAX_ATTEMPTS = 3
const MAX_RETRY_WAIT_MS = 60_000

/** The fields this client reads from a Google service account JSON key. */
export const playCredentialsSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.string().optional(),
})

/** A Google service account key with access to the Play Console app. */
export type GooglePlayCredentials = z.infer<typeof playCredentialsSchema>

/** Injectable network, clock, and wait, so tests run without the network or real delays. */
export type PlayOptions = {
  /** Fetch implementation. Defaults to the global fetch. */
  fetch?: FetchLike
  /** Wait between retries. Defaults to a timer. */
  sleep?: (ms: number) => Promise<void>
  /** Current time in milliseconds. Defaults to `Date.now`. */
  now?: () => number
}

/** Failure categories a caller can act on. */
export const playErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'rate-limited',
  'invalid',
  'unavailable',
])

/** One {@link playErrorCodeSchema} value. */
export type PlayErrorCode = z.infer<typeof playErrorCodeSchema>

const MESSAGES: Record<PlayErrorCode, string> = {
  unauthorized: 'Google rejected the service account. Check the JSON key.',
  forbidden: 'The service account cannot manage this app. Grant it access in Play Console.',
  'not-found': 'Google Play could not find that app, edit, or listing.',
  conflict: 'Google Play refused the change in the current state.',
  'rate-limited': 'Google Play is rate limiting requests. Try again in a minute.',
  invalid: 'Google Play rejected the request.',
  unavailable: 'Google Play is not responding. Try again later.',
}

/** A Google Play request failed. The message is safe to show and never contains credentials. */
export class GooglePlayError extends Error {
  /** HTTP status from Google, 503 when Google could not be reached, 502 for an unreadable answer. */
  readonly status: number
  /** Failure category. */
  readonly code: PlayErrorCode

  /** Create a Google Play error. */
  constructor(message: string, status: number, code: PlayErrorCode) {
    super(message)
    this.name = 'GooglePlayError'
    this.status = status
    this.code = code
  }
}

/** Listing image types this client uploads. */
export const playImageTypeSchema = z.enum([
  'phoneScreenshots',
  'sevenInchScreenshots',
  'tenInchScreenshots',
  'tvScreenshots',
  'wearScreenshots',
])

/** One {@link playImageTypeSchema} value. */
export type PlayImageType = z.infer<typeof playImageTypeSchema>

/** Google Play image type for each export target id. */
export const PLAY_IMAGE_TYPES = {
  'play-phone': 'phoneScreenshots',
  'play-tablet-7': 'sevenInchScreenshots',
  'play-tablet-10': 'tenInchScreenshots',
} as const satisfies Record<string, PlayImageType>

/** Image formats Google Play accepts for screenshots. */
export const playImageMimeSchema = z.enum(['image/png', 'image/jpeg'])

/** One {@link playImageMimeSchema} value. */
export type PlayImageMime = z.infer<typeof playImageMimeSchema>

const imageSchema = z.object({
  id: z.string(),
  url: z.string(),
  sha1: z.string().optional(),
  sha256: z.string().optional(),
})

/** A listing image as Google stores it. */
export type PlayImage = z.infer<typeof imageSchema>

const editSchema = z.object({ id: z.string(), expiryTimeSeconds: z.coerce.number() })

/** An open edit; it expires at `expiryTimeSeconds` (Unix seconds). */
export type PlayEdit = z.infer<typeof editSchema>

const googleErrorSchema = z.object({ error: z.object({ message: z.string().optional() }) })
const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number() })

// Keyed by the credentials object, so a token lives exactly as long as the caller's client.
const tokens = new WeakMap<GooglePlayCredentials, { value: string; expiresAt: number }>()

/** Open a new edit. */
export async function createEdit(
  creds: GooglePlayCredentials,
  packageName: string,
  options: PlayOptions = {}
): Promise<PlayEdit> {
  const url = `${API}/${encodeURIComponent(packageName)}/edits`
  return parse(
    editSchema,
    await call(creds, options, 'POST', url, { type: 'application/json', data: '{}' })
  )
}

/** The images of one type in one listing language of an edit. */
export async function listImages(
  creds: GooglePlayCredentials,
  packageName: string,
  editId: string,
  language: string,
  imageType: PlayImageType,
  options: PlayOptions = {}
): Promise<PlayImage[]> {
  const url = listingUrl(API, packageName, editId, language, imageType)
  const body = parse(
    z.object({ images: z.array(imageSchema).optional() }),
    await call(creds, options, 'GET', url)
  )
  return body.images ?? []
}

/** Delete every image of one type in one listing language of an edit. Returns the deleted images. */
export async function deleteAllImages(
  creds: GooglePlayCredentials,
  packageName: string,
  editId: string,
  language: string,
  imageType: PlayImageType,
  options: PlayOptions = {}
): Promise<PlayImage[]> {
  const url = listingUrl(API, packageName, editId, language, imageType)
  const body = parse(
    z.object({ deleted: z.array(imageSchema).optional() }).nullable(),
    await call(creds, options, 'DELETE', url)
  )
  return body?.deleted ?? []
}

/**
 * Upload one image into a listing of an edit. An image with the same
 * SHA-256 already in the listing is returned instead of uploading again.
 */
export async function uploadImage(
  creds: GooglePlayCredentials,
  packageName: string,
  editId: string,
  language: string,
  imageType: PlayImageType,
  bytes: Uint8Array,
  mime: PlayImageMime,
  options: PlayOptions = {}
): Promise<PlayImage> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = await listImages(creds, packageName, editId, language, imageType, options)
  const same = existing.find((image) => image.sha256?.toLowerCase() === sha256)
  if (same) return same
  const url = `${listingUrl(UPLOAD_API, packageName, editId, language, imageType)}?uploadType=media`
  const body = await call(creds, options, 'POST', url, { type: mime, data: bytes.slice() })
  return parse(z.object({ image: imageSchema }), body).image
}

/** Ask Google to check an edit without committing it. */
export async function validateEdit(
  creds: GooglePlayCredentials,
  packageName: string,
  editId: string,
  options: PlayOptions = {}
): Promise<PlayEdit> {
  const url = `${editUrl(packageName, editId)}:validate`
  return parse(editSchema, await call(creds, options, 'POST', url))
}

/**
 * Commit an edit, publishing its listing changes. This is the only call
 * that changes the live store listing; nothing else in this module calls it.
 * `changesNotSentForReview` is for apps where Play Console sends changes for
 * review manually.
 */
export async function commitEdit(
  creds: GooglePlayCredentials,
  packageName: string,
  editId: string,
  options: PlayOptions & { changesNotSentForReview?: boolean } = {}
): Promise<PlayEdit> {
  const query = options.changesNotSentForReview ? '?changesNotSentForReview=true' : ''
  const url = `${editUrl(packageName, editId)}:commit${query}`
  return parse(editSchema, await call(creds, options, 'POST', url))
}

/** Discard an edit and everything in it. */
export async function deleteEdit(
  creds: GooglePlayCredentials,
  packageName: string,
  editId: string,
  options: PlayOptions = {}
): Promise<void> {
  await call(creds, options, 'DELETE', editUrl(packageName, editId))
}

function editUrl(packageName: string, editId: string): string {
  return `${API}/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}`
}

function listingUrl(
  base: string,
  packageName: string,
  editId: string,
  language: string,
  imageType: PlayImageType
): string {
  return `${base}/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}`
}

async function call(
  creds: GooglePlayCredentials,
  options: PlayOptions,
  method: string,
  url: string,
  body?: { type: string; data: BodyInit }
): Promise<unknown> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${await accessToken(creds, options)}`,
  }
  if (body) headers['content-type'] = body.type
  const response = await send(options, url, { method, headers, body: body?.data })
  if (!response.ok) throw await failureFrom(response)
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

async function accessToken(creds: GooglePlayCredentials, options: PlayOptions): Promise<string> {
  const now = (options.now ?? Date.now)()
  const cached = tokens.get(creds)
  if (cached && now < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.value
  const tokenUri = creds.token_uri ?? DEFAULT_TOKEN_URI
  // The signed assertion is a credential: only send it to Google's OAuth hosts.
  if (!isGoogleTokenUri(tokenUri)) {
    throw new GooglePlayError(
      'The service account token_uri is not a Google OAuth address.',
      400,
      'invalid'
    )
  }
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: assertion(creds, tokenUri, now),
  })
  const response = await send(options, tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!response.ok) throw failure(response.status >= 500 ? response.status : 401)
  const body = parse(tokenSchema, await response.json().catch(() => null))
  tokens.set(creds, { value: body.access_token, expiresAt: now + body.expires_in * 1000 })
  return body.access_token
}

function isGoogleTokenUri(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && TOKEN_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function assertion(creds: GooglePlayCredentials, audience: string, now: number): string {
  const iat = Math.floor(now / 1000)
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const payload = encode({
    iss: creds.client_email,
    scope: SCOPE,
    aud: audience,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
  })
  try {
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${payload}`)
      .sign(creds.private_key)
    return `${header}.${payload}.${signature.toString('base64url')}`
  } catch {
    throw failure(401)
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Fetch with retries for 429, 5xx, and network failures. Returns the last response. */
async function send(options: PlayOptions, url: string, init: RequestInit): Promise<Response> {
  const fetcher = options.fetch ?? fetch
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(60_000) }).catch(
      () => null
    )
    const retryable = !response || response.status >= 500 || response.status === 429
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

function errorCode(status: number): PlayErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limited'
  return status < 500 ? 'invalid' : 'unavailable'
}

function failure(status: number, detail?: string): GooglePlayError {
  const code = errorCode(status)
  const message = detail ? `${MESSAGES[code]} Google says: ${detail.slice(0, 500)}` : MESSAGES[code]
  return new GooglePlayError(message, status, code)
}

/** Map a failed API response. Google's `error.message` describes the request, never the token. */
async function failureFrom(response: Response): Promise<GooglePlayError> {
  if (response.status >= 500) return failure(response.status)
  const body = googleErrorSchema.safeParse(await response.json().catch(() => null))
  return failure(response.status, body.success ? body.data.error.message : undefined)
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new GooglePlayError(
      'Google Play returned a response this client does not understand.',
      502,
      'unavailable'
    )
  }
  return result.data
}
