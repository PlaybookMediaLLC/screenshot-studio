'use client'

import { useCallback } from 'react'
import type { DesignDocument } from '@/lib/design/document'
import { captureStage } from '@/lib/render/capture'
import { StageRenderer } from './StageRenderer'

declare global {
  interface Window {
    __designReady?: boolean
    __exportDesign?: () => Promise<{
      base64: string
      height: number
      mediaType: string
      width: number
    }>
  }
}

export type DesignRenderOutput = { format: 'jpeg' | 'png' | 'webp'; scale: 1 | 2 | 3 }

type DesignRenderStageProps = {
  document: DesignDocument
  output: DesignRenderOutput
  sources: Record<string, string>
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/**
 * Renders one design for the headless renderer, then exposes
 * `window.__exportDesign`, which runs the editor's own export in the page.
 */
export function DesignRenderStage({ document, output, sources }: DesignRenderStageProps) {
  const handleReady = useCallback(() => {
    window.__exportDesign = async () => {
      const { blob, height, width } = await captureStage({ format: output.format, scale: output.scale })
      return {
        base64: await blobToBase64(blob),
        height,
        mediaType: blob.type || `image/${output.format}`,
        width,
      }
    }
    window.__designReady = true
  }, [output.format, output.scale])

  return (
    <main className="flex min-h-screen items-center justify-center bg-transparent p-6">
      <StageRenderer document={document} onReady={handleReady} sources={sources} />
    </main>
  )
}
