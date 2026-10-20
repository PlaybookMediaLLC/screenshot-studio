import { applyBrandKit, type BrandCategory } from '@/lib/brand/apply'
import type { BrandKit } from '@/lib/brand/kit'
import type { CanvasCommand } from './commands'
import type { CanvasDocument } from './document'

/**
 * A brand kit applied to some artboards as one command. Each artboard keeps
 * its own binding, so a property a person changed after the last
 * application stays as they set it unless they ask to reset overrides.
 */
export function brandCommand(
  canvas: CanvasDocument,
  ids: readonly string[],
  kit: BrandKit,
  categories: readonly BrandCategory[],
  { resetOverrides = false }: { resetOverrides?: boolean } = {}
): { command: Extract<CanvasCommand, { type: 'update-documents' }> | null; keptOverrides: number } {
  let keptOverrides = 0
  const documents = canvas.artboards
    .filter((artboard) => ids.includes(artboard.id))
    .map((artboard) => {
      const result = applyBrandKit(artboard.document, kit, categories, {
        binding: artboard.document.brand,
        resetOverrides,
      })
      keptOverrides += result.keptOverrides.length
      return { id: artboard.id, document: { ...result.document, brand: result.binding } }
    })
  return {
    command: documents.length ? { type: 'update-documents', documents } : null,
    keptOverrides,
  }
}
