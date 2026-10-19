'use client'

import * as React from 'react'
import type { FontSource, StoreAsset, StoreDocument } from '@/lib/store-screenshots/document/schema'
import { evaluateSlide, type Scene } from '@/lib/store-screenshots/engine/scene'
import { approximateMeasurer, type TextMeasurer } from '@/lib/store-screenshots/engine/text'
import { googleFontStylesheetUrl } from '@/lib/store-screenshots/fonts'
import { getAssetBlob } from '@/lib/store-screenshots/persistence/projects'
import type { PixelSize } from '@/lib/store-screenshots/targets'
import { createDomMeasurer } from './dom-measurer'
import type { AssetResolver } from './SlideRender'

/**
 * Shared rendering services: asset URLs, project fonts, and text
 * measurement. Object URLs are revoked when their asset leaves the project
 * or the provider unmounts.
 */

type RenderServices = {
  measurer: TextMeasurer
  resolveAsset: AssetResolver
  /** Changes when fonts finish loading; part of scene memo keys. */
  fontsVersion: number
  /** Resolve once every listed asset has a URL (or failed to load). */
  whenAssetsReady: (ids: string[]) => Promise<void>
}

const RenderContext = React.createContext<RenderServices | null>(null)

/** Rendering services for descendants. */
export function useRenderServices(): RenderServices {
  const context = React.useContext(RenderContext)
  if (!context) throw new Error('useRenderServices must be used inside <RenderProvider>.')
  return context
}

function useAssetUrls(assets: Record<string, StoreAsset>, loadAsset: (id: string) => Promise<Blob | null>) {
  const [urls, setUrls] = React.useState<ReadonlyMap<string, string>>(() => new Map())
  const pendingRef = React.useRef(new Map<string, Promise<void>>())
  const urlsRef = React.useRef(urls)
  const generationRef = React.useRef(0)

  const load = React.useCallback(
    (id: string): Promise<void> => {
      const existing = pendingRef.current.get(id)
      if (existing) return existing
      const generation = generationRef.current
      const promise = loadAsset(id)
        .then((blob) => {
          if (!blob || generation !== generationRef.current) return
          const url = URL.createObjectURL(blob)
          urlsRef.current = new Map(urlsRef.current).set(id, url)
          setUrls(urlsRef.current)
        })
        .catch(() => undefined)
      pendingRef.current.set(id, promise)
      return promise
    },
    [loadAsset]
  )

  React.useEffect(() => {
    for (const asset of Object.values(assets)) {
      if (!asset.src) void load(asset.id)
    }
  }, [assets, load])

  React.useEffect(
    () => () => {
      // Activity cleans up effects while preserving state; reload revoked URLs on return.
      generationRef.current += 1
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url)
      urlsRef.current = new Map()
      pendingRef.current.clear()
      setUrls(urlsRef.current)
    },
    []
  )

  const resolveAsset = React.useCallback<AssetResolver>(
    (id) => assets[id]?.src ?? urls.get(id) ?? null,
    [assets, urls]
  )

  const whenAssetsReady = React.useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.filter((id) => assets[id] && !assets[id].src).map((id) => load(id)))
    },
    [assets, load]
  )

  return { resolveAsset, whenAssetsReady }
}

function useProjectFonts(fonts: FontSource[], resolveAsset: AssetResolver): void {
  const key = JSON.stringify(fonts.map((font) => [font.family, font.kind, font.assetId, font.assetId ? Boolean(resolveAsset(font.assetId)) : true]))
  React.useEffect(() => {
    const nodes: HTMLElement[] = []
    for (const font of fonts) {
      if (font.kind === 'google') {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = googleFontStylesheetUrl(font.family)
        link.crossOrigin = 'anonymous'
        link.dataset.storeFont = font.family
        document.head.appendChild(link)
        nodes.push(link)
      } else if (font.assetId) {
        const url = resolveAsset(font.assetId)
        if (!url) continue
        const style = document.createElement('style')
        style.dataset.storeFont = font.family
        style.textContent = `@font-face{font-family:"${font.family}";src:url("${url}");font-display:swap;}`
        document.head.appendChild(style)
        nodes.push(style)
      }
    }
    return () => nodes.forEach((node) => node.remove())
    // `key` captures every input that changes the injected rules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** Provide rendering services for a document. `loadAsset` defaults to the browser asset store. */
export function RenderProvider({
  document: storeDocument,
  loadAsset = getAssetBlob,
  children,
}: {
  document: Pick<StoreDocument, 'assets' | 'fonts'>
  loadAsset?: (id: string) => Promise<Blob | null>
  children: React.ReactNode
}): React.JSX.Element {
  const [measurer] = React.useState(() =>
    typeof document === 'undefined' ? null : createDomMeasurer()
  )
  const [fontsVersion, setFontsVersion] = React.useState(0)
  const { resolveAsset, whenAssetsReady } = useAssetUrls(storeDocument.assets, loadAsset)
  useProjectFonts(storeDocument.fonts, resolveAsset)

  React.useEffect(() => {
    if (!measurer) return
    const refresh = () => {
      measurer.clear()
      setFontsVersion((value) => value + 1)
    }
    document.fonts.addEventListener('loadingdone', refresh)
    void document.fonts.ready.then(refresh)
    return () => document.fonts.removeEventListener('loadingdone', refresh)
  }, [measurer])

  const value = React.useMemo<RenderServices>(
    () => ({
      measurer: measurer?.measure ?? approximateMeasurer,
      resolveAsset,
      fontsVersion,
      whenAssetsReady,
    }),
    [measurer, resolveAsset, fontsVersion, whenAssetsReady]
  )
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>
}

/**
 * Evaluate a slide, recomputing only when something it depends on changes:
 * its own slide object, the theme, assets, panoramas, template, locale,
 * size, or loaded fonts. Other slides' edits do not re-evaluate it.
 */
export function useSlideScene(
  storeDocument: StoreDocument,
  index: number,
  options: { size: PixelSize; targetId: string; locale: string }
): Scene | null {
  const { measurer, fontsVersion } = useRenderServices()
  const slide = storeDocument.slides[index]
  const { theme, assets, panoramas, templateId, localization } = storeDocument
  const { width, height } = options.size
  return React.useMemo(() => {
    if (!slide) return null
    void fontsVersion
    return evaluateSlide(storeDocument, index, {
      size: { width, height },
      targetId: options.targetId,
      locale: options.locale,
      measurer,
    })
    // The listed fields are exactly what evaluateSlide reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, index, theme, assets, panoramas, templateId, localization.sourceLocale, width, height, options.targetId, options.locale, measurer, fontsVersion])
}
