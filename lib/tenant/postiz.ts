import 'server-only'

import { z } from 'zod'
import { readTenantObject } from '@/lib/storage/client'

const defaultPostizUrl = 'https://api.postiz.com/public/v1'
const postizUploadSchema = z.object({ id: z.string(), path: z.string() })
const postizPostSchema = z
  .array(z.object({ postId: z.string(), integration: z.string() }))
  .length(1)
const postizPostStatusSchema = z.object({
  postId: z.string(),
  state: z.enum(['QUEUE', 'PUBLISHED', 'ERROR', 'DRAFT']),
  releaseId: z.string().nullable(),
  releaseURL: z.string().nullable(),
})
const postizMeSchema = z.object({ organization: z.object({ id: z.string().min(1) }) })
const postizIntegrationsSchema = z.array(
  z.object({
    id: z.string(),
    identifier: z.string(),
    disabled: z.boolean(),
  })
)

type PostizAsset = {
  mediaType: string
  objectKey: string
}

export type PostizPublishInput = {
  asset: PostizAsset
  caption: string
  destinationId: string
  expectedGoOrganizationId: string
  organizationId: string
  platform: string
  providerSettings: unknown
  secretReference: string
}

async function verifyPostizOrganization(
  configuration: { baseUrl: string; token: string },
  expectedGoOrganizationId: string
): Promise<void> {
  const me = postizMeSchema.parse(await requestPostiz(configuration, 'me', { method: 'GET' }))
  if (me.organization.id !== expectedGoOrganizationId) {
    throw new PostizProviderError('Postiz organization does not match this workspace.', 403)
  }
}

export async function verifyPostizDestination(input: {
  destinationId: string
  expectedGoOrganizationId: string
  platform: string
  secretReference: string
}): Promise<void> {
  const configuration = getPostizConfiguration(input.secretReference)
  await verifyPostizOrganization(configuration, input.expectedGoOrganizationId)
  const integrations = postizIntegrationsSchema.parse(
    await requestPostiz(configuration, 'integrations', { method: 'GET' })
  )
  if (
    !integrations.some(
      (item) =>
        item.id === input.destinationId && item.identifier === input.platform && !item.disabled
    )
  ) {
    throw new PostizProviderError('Postiz destination is unavailable for this workspace.', 404)
  }
}

export async function beginPostizOAuth(input: {
  expectedGoOrganizationId: string
  provider: 'x' | 'instagram' | 'instagram-standalone'
  secretReference: string
}): Promise<string> {
  const configuration = getPostizConfiguration(input.secretReference)
  await verifyPostizOrganization(configuration, input.expectedGoOrganizationId)
  const response = z
    .object({ url: z.string().url() })
    .parse(await requestPostiz(configuration, `social/${input.provider}`, { method: 'GET' }))
  return response.url
}

export class PostizProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly unknownDelivery = false
  ) {
    super(message)
  }
}

export function isPostizSecretReference(reference: string): boolean {
  return /^POSTIZ_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$/.test(reference)
}

function getPostizConfiguration(secretReference: string): { baseUrl: string; token: string } {
  if (!isPostizSecretReference(secretReference)) {
    throw new PostizProviderError('Invalid Postiz credential reference.', null)
  }

  const token = process.env[secretReference]
  if (!token) {
    throw new PostizProviderError('Postiz credentials are unavailable.', null)
  }

  return { baseUrl: process.env.POSTIZ_API_URL ?? defaultPostizUrl, token }
}

function getPostizUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString()
}

async function requestPostiz(
  configuration: { baseUrl: string; token: string },
  path: string,
  init: RequestInit
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(getPostizUrl(configuration.baseUrl, path), {
      ...init,
      headers: { Authorization: configuration.token, ...init.headers },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new PostizProviderError(
      'Postiz is unavailable.',
      null,
      path === 'posts' && init.method === 'POST'
    )
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new PostizProviderError(
      `Postiz request failed with ${response.status}.`,
      response.status,
      path === 'posts' && init.method === 'POST' && response.status >= 500
    )
  }
  return body
}

function getFileName(objectKey: string): string {
  return objectKey.split('/').at(-1) ?? 'asset'
}

async function uploadPostizAsset(
  configuration: { baseUrl: string; token: string },
  input: Pick<PostizPublishInput, 'asset' | 'organizationId'>
) {
  const bytes = await readTenantObject({
    objectKey: input.asset.objectKey,
    organizationId: input.organizationId,
  })
  const uploadBytes = Uint8Array.from(bytes)
  const form = new FormData()
  form.set(
    'file',
    new Blob([uploadBytes], { type: input.asset.mediaType }),
    getFileName(input.asset.objectKey)
  )
  return postizUploadSchema.parse(
    await requestPostiz(configuration, 'upload', { body: form, method: 'POST' })
  )
}

function getPostizSettings(platform: string, providerSettings: unknown): Record<string, unknown> {
  const settings = z.record(z.string(), z.json()).parse(providerSettings)
  return { ...settings, __type: platform }
}

export async function publishPostizPost(input: PostizPublishInput): Promise<string> {
  const configuration = getPostizConfiguration(input.secretReference)
  await verifyPostizDestination({
    destinationId: input.destinationId,
    expectedGoOrganizationId: input.expectedGoOrganizationId,
    platform: input.platform,
    secretReference: input.secretReference,
  })
  const image = await uploadPostizAsset(configuration, input)
  const payload = {
    date: new Date().toISOString(),
    posts: [
      {
        integration: { id: input.destinationId },
        settings: getPostizSettings(input.platform, input.providerSettings),
        value: [{ content: input.caption, image: [image] }],
      },
    ],
    shortLink: false,
    tags: [],
    type: 'now',
  }
  const receipt = await requestPostiz(configuration, 'posts', {
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const parsed = postizPostSchema.safeParse(receipt)
  if (!parsed.success) {
    throw new PostizProviderError('Postiz returned an invalid post receipt.', null, true)
  }
  const [post] = parsed.data
  if (post.integration !== input.destinationId) {
    throw new PostizProviderError('Postiz returned an unexpected destination.', null, true)
  }
  return post.postId
}

export async function getPostizPostStatus(secretReference: string, postId: string) {
  const configuration = getPostizConfiguration(secretReference)
  const status = postizPostStatusSchema.parse(
    await requestPostiz(configuration, `posts/${encodeURIComponent(postId)}/status`, {
      method: 'GET',
    })
  )
  if (status.postId !== postId) {
    throw new PostizProviderError('Postiz returned an unexpected post.', null)
  }
  return status
}
