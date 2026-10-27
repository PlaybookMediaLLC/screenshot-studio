import { applyBrandKit } from '@/lib/brand/apply'
import type { BrandKit } from '@/lib/brand/kit'
import {
  creativeSetDocumentSchema,
  type CreativeOutput,
  type CreativeSetDocument,
} from './document'

export const TEXT_BRAND_FIELDS = { color: 'Color', fontFamily: 'Font', fill: 'Text fill' } as const
export type TextBrandField = keyof typeof TEXT_BRAND_FIELDS

/** Fields assigned by the pinned brand and subsequently changed in this format. */
export function localTextBrandFields(output: CreativeOutput, layerId: string): TextBrandField[] {
  const text = output.document.texts.find((text) => text.id === layerId)
  if (!text) return []
  return (Object.keys(TEXT_BRAND_FIELDS) as TextBrandField[]).filter((field) => {
    const value = output.document.brand?.applied[`texts.${layerId}.${field}`]
    return value !== undefined && JSON.stringify(value) !== JSON.stringify(text[field])
  })
}

/** Reset one style field to the pinned version, leaving placement, copy and other styling intact. */
export function resetTextBrandField(
  set: CreativeSetDocument,
  outputId: string,
  layerId: string,
  field: TextBrandField,
  kit: BrandKit
): CreativeSetDocument {
  const next = structuredClone(set)
  if (kit.id !== next.brand?.id || kit.version !== next.brand.version)
    throw new Error('Load the pinned brand version before resetting.')
  const output = next.outputs.find((output) => output.id === outputId)
  if (!output) throw new Error('Format missing.')
  const desired = applyBrandKit(output.document, kit, ['colors', 'typography'], {
    resetOverrides: true,
  })
  const target = output.document.texts.find((text) => text.id === layerId)
  const value = desired.document.texts.find((text) => text.id === layerId)?.[field]
  if (!target || value === undefined || !output.document.brand)
    throw new Error('This field is not linked to the brand.')
  Object.assign(target, { [field]: value })
  output.document.brand.applied[`texts.${layerId}.${field}`] = JSON.parse(JSON.stringify(value))
  return creativeSetDocumentSchema.parse(next)
}
