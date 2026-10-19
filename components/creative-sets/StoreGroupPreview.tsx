'use client'

import { useCallback, useState } from 'react'
import { RenderProvider } from '@/components/store-screenshots/render/RenderProvider'
import { SlideThumbnail } from '@/components/store-screenshots/studio/SlideThumbnail'
import { getStoreTarget, targetPixelSize } from '@/lib/store-screenshots/targets'
import { useTRPCClient } from '@/lib/trpc/react'
import { loadStoreAsset } from '@/lib/creative-sets/store-assets'
import type { StoreGroup } from '@/lib/creative-sets/store-schema'

/** Lightweight native previews share the store renderer without another editing session. */
export function StoreGroupPreview({ group }: { group: StoreGroup }) {
  const client = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const loadAsset = useCallback(
    async (id: string) => {
      try {
        return await loadStoreAsset(client, group, id)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'A preview asset is unavailable.')
        throw error
      }
    },
    [client, group]
  )
  const target = getStoreTarget('ios-iphone-6.9')!
  return (
    <RenderProvider document={group.document} loadAsset={loadAsset}>
      <div className="flex max-w-full gap-2 overflow-x-auto" aria-label={`${group.name} slides`}>
        {group.document.slides.map((slide, index) => (
          <SlideThumbnail
            key={slide.id}
            document={group.document}
            index={index}
            size={targetPixelSize(target, 0, 'portrait')}
            targetId={target.id}
            locale={group.document.localization.sourceLocale}
            height={220}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </RenderProvider>
  )
}
