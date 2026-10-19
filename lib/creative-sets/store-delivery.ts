'use client'

import type { StoreDocument } from '@/lib/store-screenshots/document/schema'
import type { ExportOutput } from '@/lib/store-screenshots/export/job'
import type { CreativeSetDocument } from './document'
import type { StoreGroup } from './store-schema'
import { resolvedDocumentHash } from './delivery'

async function waitForFonts<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 15_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Never deliver a missing asset or a fallback font as the approved composition. */
export async function assertStoreAssetsReady(
  native: StoreDocument,
  resolveAsset: (id: string) => string | null
): Promise<void> {
  for (const asset of Object.values(native.assets))
    if (!resolveAsset(asset.id)) throw new Error(`Missing asset: ${asset.name}.`)
  for (const font of native.fonts) {
    const link = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[data-store-font]')
    ).find((link) => link.dataset.storeFont === font.family)
    if (font.kind === 'google' && !link?.sheet) {
      if (!link) throw new Error(`Font unavailable: ${font.family}.`)
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer)
          link.removeEventListener('load', loaded)
          link.removeEventListener('error', failed)
          if (error) reject(error)
          else resolve()
        }
        const loaded = () => finish()
        const failed = () => finish(new Error(`Font unavailable: ${font.family}.`))
        const timer = setTimeout(failed, 15_000)
        link.addEventListener('load', loaded, { once: true })
        link.addEventListener('error', failed, { once: true })
      })
    }
    const faces = await waitForFonts(
      document.fonts.load(`16px ${JSON.stringify(font.family)}`),
      `Font unavailable: ${font.family}.`
    )
    if (!faces.length || faces.some((face) => face.status !== 'loaded'))
      throw new Error(`Font unavailable: ${font.family}.`)
  }
  await waitForFonts(document.fonts.ready, 'Fonts did not finish loading.')
}

/** Bind each exact store file to its native slide, target, locale and saved set revision. */
export async function storeDeliveryManifest(
  set: CreativeSetDocument,
  group: StoreGroup,
  revision: number,
  outputs: ExportOutput[]
) {
  const documentHash = await resolvedDocumentHash(group.document)
  return outputs.map(({ file }) => ({
    id: crypto.randomUUID(),
    revision,
    outputId: group.id,
    fileName: `${group.id.slice(0, 8)}/r${revision}/${file.path}`,
    documentHash,
    sources: [...new Set(Object.values(group.assetMap))],
    brand: set.brand ? { id: set.brand.id, version: set.brand.version } : null,
    composition: { id: group.document.templateId, version: group.document.version },
    store: {
      slideId: file.slideId,
      targetId: file.targetId,
      locale: file.locale,
      width: file.size.width,
      height: file.size.height,
    },
  }))
}
