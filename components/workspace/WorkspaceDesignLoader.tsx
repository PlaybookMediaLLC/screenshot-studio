'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { applyDesignDocument, applyDesignLayout, waitForSettledCanvas } from '@/lib/design/apply'
import { getDesignAssetIds } from '@/lib/design/document'
import { useImageStore } from '@/lib/store'
import { useTRPCClient } from '@/lib/trpc/react'

/**
 * Opens a stored design in the editor when the URL carries ?design=<id>.
 *
 * Unlike ?asset=, which loads a flat image, this restores the whole
 * composition: template, background, frame, devices, text, overlays and
 * annotations stay individually editable. Workspace images are fetched into
 * blob URLs so the editor's export never sees a cross-origin image.
 */
export function WorkspaceDesignLoader() {
  const trpcClient = useTRPCClient()
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    if (startedRef.current) return
    const designId = new URLSearchParams(window.location.search).get('design')
    if (!designId) return
    startedRef.current = true

    async function load(id: string): Promise<void> {
      const { design } = await trpcClient.design.get.query({ designId: id })
      const sources: Record<string, string> = {}
      for (const assetId of getDesignAssetIds(design.document)) {
        const { downloadUrl } = await trpcClient.asset.signDownload.query({ assetId })
        const response = await fetch(downloadUrl)
        if (!response.ok) throw new Error(`The download failed with status ${response.status}.`)
        sources[`asset:${assetId}`] = URL.createObjectURL(await response.blob())
      }
      const resolve = (ref: string) => sources[ref] ?? ref
      applyDesignDocument(design.document, resolve)
      const preset = getAspectRatioPreset(useImageStore.getState().selectedAspectRatio)
      const canvas = await waitForSettledCanvas(preset ? preset.width / preset.height : null)
      applyDesignLayout(design.document, resolve, canvas)
      const url = new URL(window.location.href)
      url.searchParams.delete('design')
      window.history.replaceState(null, '', url)
      toast.success(`Opened “${design.name}”`)
    }

    load(designId).catch(() => {
      toast.error('Could not open the design', {
        description: 'It may have been deleted, or you may not have access to it.',
      })
    })
  }, [trpcClient])

  return null
}
