import 'server-only'

import { z } from 'zod'
import { readTenantObject } from '@/lib/storage/client'

const defaultPostizUrl = 'https://api.postiz.com/public/v1'
const postizUploadSchema = z.object({ id: z.string(), path: z.string() })
const postizPostSchema = z.object({ id: z.string() })

type PostizAsset = {
  mediaType: string
  objectKey: string
}

export type PostizPublishInput = {
  asset: PostizAsset
  caption: string
  destinationId: string
  organizationId: string
  platform: string
  providerSettings: unknown
  secretReference: string
}

export class PostizProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null
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
    throw new PostizProviderError('Postiz is unavailable.', null)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new PostizProviderError(`Postiz request failed with ${response.status}.`, response.status)
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
  return postizPostSchema.parse(
    await requestPostiz(configuration, 'posts', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  ).id
}
