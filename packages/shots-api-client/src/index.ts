import createClient from 'openapi-fetch'
import type { paths } from './schema.js'

export type { components, operations, paths } from './schema.js'

/** Where the client sends requests and the workspace API key it sends. */
export type ShotsClientOptions = {
  /** A workspace API key (`ss_...`), sent as `X-API-Key`. */
  apiKey: string
  /** Defaults to production. */
  baseUrl?: string
}

/**
 * A client for the Shots REST API. Every path, parameter, body, and response
 * is typed from the production OpenAPI document (`/openapi.json`).
 *
 * ```ts
 * const shots = createShotsClient({ apiKey: process.env.SHOTS_API_KEY! })
 * const { data, error } = await shots.GET('/api/v1/campaigns')
 * ```
 */
export function createShotsClient({
  apiKey,
  baseUrl = 'https://shots.playbookmedia.io',
}: ShotsClientOptions) {
  return createClient<paths>({ baseUrl, headers: { 'X-API-Key': apiKey } })
}
