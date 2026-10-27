type ThumbnailStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { EX: number }): Promise<unknown>
}

// shortcut: cold renders coalesce per process; add a distributed lock if replica cold starts dominate.
const rendering = new Map<string, Promise<Buffer>>()

/** Asset IDs identify immutable bytes; bump v1 when thumbnail dimensions/encoding change. */
export function thumbnailKey(organizationId: string, assetId: string): string {
  return `platform:asset-thumbnail:v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(assetId)}`
}

/** Authorize every caller before consulting the private derivative cache. */
export async function cachedThumbnail(
  key: string,
  authorize: () => Promise<void>,
  load: () => Promise<Buffer>,
  store: () => Promise<ThumbnailStore | null>
): Promise<Buffer> {
  await authorize()
  const existing = rendering.get(key)
  if (existing) return existing
  const render = (async () => {
    const cache = await store().catch(() => null)
    const cached = await cache?.get(key).catch(() => null)
    if (cached) return Buffer.from(cached, 'base64')
    const thumbnail = await load()
    // Cache outages must not make an otherwise readable asset unavailable.
    await cache?.set(key, thumbnail.toString('base64'), { EX: 86_400 }).catch(() => undefined)
    return thumbnail
  })()
  rendering.set(key, render)
  try {
    return await render
  } finally {
    rendering.delete(key)
  }
}
