'use client'

import { getCanvasContainer } from '@/components/canvas/ClientCanvas'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { exportElementAsCanvas } from '@/lib/export/export-service'
import { useEditorStore, useImageStore } from '@/lib/store'

/**
 * A small JPEG of the canvas, for the model to see what it changed. Uses the
 * editor's own export so the snapshot matches what the user would export.
 */
export async function captureCanvasSnapshot(maxWidth = 1024): Promise<string | null> {
  const image = useImageStore.getState()
  const preset = getAspectRatioPreset(image.selectedAspectRatio)
  if (!preset || !document.getElementById('image-render-card')) return null
  const scale = Math.min(1, maxWidth / preset.width)
  try {
    const canvas = await exportElementAsCanvas(
      'image-render-card',
      {
        exportHeight: Math.round(preset.height * scale),
        exportWidth: Math.round(preset.width * scale),
        format: 'jpeg',
        qualityPreset: 'medium',
        scale: 1,
        skipSharp: true,
      },
      getCanvasContainer(),
      image.backgroundBorderRadius,
      image.perspective3D,
      useEditorStore.getState().screenshot.src || undefined
    )
    return canvas.toDataURL('image/jpeg', 0.72).split(',')[1] ?? null
  } catch {
    return null
  }
}
