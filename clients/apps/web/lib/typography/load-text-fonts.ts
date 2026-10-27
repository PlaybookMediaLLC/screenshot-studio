'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { type TextOverlay, useImageStore } from '@/lib/store'
import { googleFontFamily, isGoogleFontId, loadGoogleFont, InvalidGoogleFontFamily } from './google-fonts'

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
    const families = googleFontsInUse(useImageStore.getState().textOverlays)
    void Promise.allSettled(families.map(({ id, weights }) => loadGoogleFont(id, weights))).then((results) => {
      if (!active) return
      const invalid = new Set(families.filter((_, index) => {
        const result = results[index]
        return result.status === 'rejected' && result.reason instanceof InvalidGoogleFontFamily
      }).map(({ id }) => id))
      if (invalid.size) {
        useImageStore.setState((state) => ({ textOverlays: state.textOverlays.map((text) =>
          invalid.has(text.fontFamily) ? { ...text, fontFamily: 'inter' } : text
        ) }))
        toast.info('Unavailable font replaced', { description: 'A saved font name does not exist in Google Fonts. Those text layers now use Inter; choose another font in Typography.' })
      }
      results.forEach((result, index) => {
        const { id } = families[index]
        const family = googleFontFamily(id)
        if (result.status !== 'rejected' || invalid.has(id) || warned.has(family)) return
        warned.add(family)
        toast.error(`Couldn't load ${family}`, {
          description: 'The text uses a similar system font. Check your connection, then pick it again.',
        })
      })
    })
    return () => {
      active = false
    }
  }, [key])
}
