'use client'

import { STAGE_ELEMENT_ID } from './capture'
import { loadTextFonts } from '@/lib/typography/load-text-fonts'
import { useImageStore } from '@/lib/store'

/** Strict delivery checks run on the same DOM that is captured, after layout and fonts settle. */
export async function assertStageReady(): Promise<void> {
  const failed = await loadTextFonts(useImageStore.getState().textOverlays)
  if (failed.length)
    throw new Error(`Font failed to load: ${failed.join(', ')}. Choose an available font.`)
  const stage = document.getElementById(STAGE_ELEMENT_ID)
  if (!stage) throw new Error('The output canvas is missing.')
  await Promise.all(
    Array.from(stage.querySelectorAll('img')).map(async (image) => {
      try {
        await image.decode()
      } catch {
        throw new Error('An image could not be loaded. Replace or reconnect it before exporting.')
      }
      if (!image.naturalWidth) throw new Error('An image is empty.')
    })
  )
  const bounds = stage.getBoundingClientRect()
  for (const text of stage.querySelectorAll<HTMLElement>('[data-text-overlay-id]')) {
    const style = getComputedStyle(text)
    if (style.display === 'none' || Number(style.opacity) === 0) continue
    const content = (text.textContent ?? '').trim()
    if (!content) continue
    const label = `“${content.length > 48 ? `${content.slice(0, 48)}…` : content}”`
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    await document.fonts.load(font, text.textContent ?? '')
    if (!document.fonts.check(font, text.textContent ?? ''))
      throw new Error(`The font for ${label} is unavailable. Choose another font.`)
    const rect = text.getBoundingClientRect()
    if (
      rect.left < bounds.left - 1 ||
      rect.top < bounds.top - 1 ||
      rect.right > bounds.right + 1 ||
      rect.bottom > bounds.bottom + 1 ||
      text.scrollWidth > text.clientWidth + 1
    ) {
      throw new Error(
        `${label} extends beyond its text box or canvas. Shorten the copy, reduce its size, or move it inward.`
      )
    }
  }
}
