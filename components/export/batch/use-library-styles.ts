'use client'

import * as React from 'react'
import { useHydratedSession } from '@/lib/auth/client'
import { applyBrandKit, BRAND_CATEGORIES } from '@/lib/brand/apply'
import { loadBrandKits, useBrandKits } from '@/lib/brand/library'
import { type DesignDocument, mapDesignSources } from '@/lib/design/document'
import { exportDesignDocument } from '@/lib/design/export'
import { fetchDesignSources } from '@/lib/design/open-design'
import { loadPresets, usePresetLibrary } from '@/lib/presets/library'
import { applyPresetTo } from '@/lib/presets/preset'
import { useTRPCClient } from '@/lib/trpc/react'
import type { BatchStyleSource } from './BatchWorkspace'

/**
 * Batch styles from the workspace library: each saved preset, and each brand
 * kit applied to the current design. Workspace images (logos, generated
 * backgrounds) are fetched first, so the render frame draws them like the editor.
 */
export function useLibraryStyleSources(open: boolean): BatchStyleSource[] {
  const { data: session } = useHydratedSession()
  const trpcClient = useTRPCClient()
  const presets = usePresetLibrary((state) => state.presets)
  const kits = useBrandKits((state) => state.kits)
  const [sources, setSources] = React.useState<BatchStyleSource[]>([])

  React.useEffect(() => {
    if (!open || !session) return
    void loadPresets(trpcClient).catch(() => undefined)
    void loadBrandKits(trpcClient).catch(() => undefined)
  }, [open, session, trpcClient])

  React.useEffect(() => {
    if (!open || !session) return
    let active = true
    const current = exportDesignDocument({ keepLocalSources: true })
    const library: BatchStyleSource[] = [
      ...presets.map((preset) => ({
        description: 'Saved preset',
        document: applyPresetTo(preset.document, current),
        id: `preset:${preset.id}`,
        label: preset.name,
      })),
      ...kits.map((kit) => ({
        description: 'Visual brand kit on the current design',
        // The design's own overrides survive, as when the kit is applied in the editor.
        document: applyBrandKit(current, kit, BRAND_CATEGORIES, { binding: current.brand })
          .document,
        id: `brand:${kit.id}`,
        label: kit.name,
      })),
    ]
    const resolve = async (document: DesignDocument) => {
      const urls = await fetchDesignSources(trpcClient, document)
      return Object.keys(urls).length
        ? mapDesignSources(document, (ref) => urls[ref] ?? ref)
        : document
    }
    // One source at a time: a preset or kit whose image was deleted is left out alone.
    Promise.all(
      library.map(async (source) => {
        try {
          return { ...source, document: await resolve(source.document) }
        } catch {
          return null
        }
      })
    ).then((resolved) => {
      if (active)
        setSources(resolved.filter((source): source is BatchStyleSource => source !== null))
    })
    return () => {
      active = false
    }
  }, [kits, open, presets, session, trpcClient])

  return sources
}
