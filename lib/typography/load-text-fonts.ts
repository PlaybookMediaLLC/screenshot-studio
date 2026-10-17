'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { type TextOverlay, useImageStore } from '@/lib/store'
import { googleFontFamily, isGoogleFontId, loadGoogleFont } from './google-fonts'

/** Every Google Fonts family the texts use, with the weights each needs. */
export function googleFontsInUse(texts: readonly Pick<TextOverlay, 'fontFamily' | 'fontWeight'>[]) {
  const families = new Map<string, Set<string>>()
  for (const text of texts) {
    if (!isGoogleFontId(text.fontFamily)) continue
    const weights = families.get(text.fontFamily) ?? new Set<string>()
    weights.add(text.fontWeight.replace('italic', '').trim() || 'normal')
    families.set(text.fontFamily, weights)
  }
  return [...families].map(([id, weights]) => ({ id, weights: [...weights] }))
}

/** Load the texts' Google fonts; resolves with the families that failed (drawn with their fallback). */
export async function loadTextFonts(texts: readonly Pick<TextOverlay, 'fontFamily' | 'fontWeight'>[]): Promise<string[]> {
  const results = await Promise.allSettled(googleFontsInUse(texts).map(({ id, weights }) => loadGoogleFont(id, weights)))
  return googleFontsInUse(texts)
    .filter((_, index) => results[index]!.status === 'rejected')
    .map(({ id }) => googleFontFamily(id))
}

const warned = new Set<string>()

/** Keep the canvas's Google fonts loaded, and say once when one cannot be. */
export function useTextFontLoader() {
  const texts = useImageStore((state) => state.textOverlays)
  const key = googleFontsInUse(texts)
    .map(({ id, weights }) => `${id}:${weights.join(',')}`)
    .join('|')
  useEffect(() => {
    if (!key) return
    let active = true
    void loadTextFonts(useImageStore.getState().textOverlays).then((failed) => {
      for (const family of failed) {
        if (!active || warned.has(family)) continue
        warned.add(family)
        toast.error(`Couldn't load ${family}`, {
          description: 'The text uses a similar system font. Check the name or your connection, then pick it again.',
        })
      }
    })
    return () => {
      active = false
    }
  }, [key])
}
