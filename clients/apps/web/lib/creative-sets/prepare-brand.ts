'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import type { BrandKit } from '@/lib/brand/kit'
import { fetchAssetUrl } from '@/lib/design/open-design'
import { createAssetMeta } from '@/lib/store-screenshots/document/factory'
import type { CreativeSetDocument } from './document'
import { applySetBrand } from './commands'

/** Read dimensions before adding a workspace logo to the native store asset table. */
export async function prepareSetBrand(
  client: TRPCClient<AppRouter>,
  set: CreativeSetDocument,
  kit: BrandKit
) {
  const logo = kit.logos.find((logo) => logo.tone === 'any') ?? kit.logos[0]
  if (!logo || !set.storeGroups.length) return applySetBrand(set, kit)
  const response = await fetch(await fetchAssetUrl(client, logo.src.slice(6)))
  if (!response.ok) throw new Error('The brand logo could not be loaded.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return applySetBrand(set, kit, {
      source: logo.src,
      metadata: createAssetMeta({
        name: logo.name,
        mime: blob.type,
        width: image.naturalWidth,
        height: image.naturalHeight,
        bytes: blob.size,
      }),
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
