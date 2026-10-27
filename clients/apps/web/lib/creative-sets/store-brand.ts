import { applyBrandKit, brandKitFromDocument } from '@/lib/store-screenshots/brand-kits'
import { storeDocumentSchema, type StoreAsset } from '@/lib/store-screenshots/document/schema'
import { createImageLayer } from '@/lib/store-screenshots/document/elements'
import { fontName, fullHex, type BrandKit } from '@/lib/brand/kit'
import { mergeAssigned } from './merge-assigned'
import { storeGroupSchema, type StoreGroup } from './store-schema'

export type StoreBrandLogo = { metadata: StoreAsset; source: string }

/** Map brand roles, not native typography units; explicit slide styles continue to override the theme. */
export function applyStoreBrand(
  group: StoreGroup,
  kit: BrandKit,
  logo?: StoreBrandLogo
): StoreGroup {
  const next = structuredClone(group)
  const nativeKit = brandKitFromDocument(next.document, kit.name)
  nativeKit.id = kit.id
  nativeKit.palette = [
    ...new Set(
      [kit.accent, ...kit.colors.palette, kit.colors.background, kit.colors.foreground].map(fullHex)
    ),
  ].slice(0, 12)
  nativeKit.headingFont = kit.primaryFont ? fontName(kit.primaryFont) : nativeKit.headingFont
  nativeKit.bodyFont = kit.secondaryFont ? fontName(kit.secondaryFont) : nativeKit.bodyFont
  nativeKit.fontSources = [...new Set([nativeKit.headingFont, nativeKit.bodyFont])].map(
    (family) => ({ family, kind: 'google', assetId: null })
  )
  for (const role of ['heading', 'subheading', 'body'] as const)
    nativeKit.textStyles[role] = { color: fullHex(kit.colors.foreground) }
  nativeKit.background = { kind: 'solid', color: fullHex(kit.colors.background) }
  const applied = applyBrandKit(next.document, nativeKit, null, {
    colors: true,
    fonts: true,
    background: true,
    device: false,
    logo: false,
    keepOverrides: true,
  })
  next.document.theme = next.brandAssignment
    ? storeDocumentSchema.shape.theme.parse(
        mergeAssigned(next.brandAssignment.theme, next.document.theme, applied.theme)
      )
    : applied.theme
  next.document.fonts = applied.fonts
  next.document.brandKitId = kit.id
  const assignment: NonNullable<StoreGroup['brandAssignment']> = { theme: applied.theme, logos: [] }
  if (logo) {
    const assetId = next.brandAssignment?.logoAssetId ?? crypto.randomUUID()
    next.document.assets[assetId] = { ...logo.metadata, id: assetId, src: null }
    next.assetMap[assetId] = logo.source
    assignment.logoAssetId = assetId
    for (const slide of next.document.slides) {
      const previous = next.brandAssignment?.logos.find((entry) => entry.slideId === slide.id)
      const proposed = createImageLayer(assetId, `${kit.name} logo`)
      proposed.id = previous?.layer.id ?? crypto.randomUUID()
      proposed.placement = { mode: 'free', x: 50, y: 94, width: 15 }
      const local = slide.layers.find((layer) => layer.id === proposed.id)
      if (!previous) slide.layers.push(proposed)
      else if (local)
        slide.layers = slide.layers.map((layer) =>
          layer.id === proposed.id
            ? (mergeAssigned(previous.layer, local, proposed) as typeof proposed)
            : layer
        )
      assignment.logos.push({ slideId: slide.id, layer: proposed })
    }
  }
  if (!logo && next.brandAssignment) {
    for (const previous of next.brandAssignment.logos) {
      const slide = next.document.slides.find((slide) => slide.id === previous.slideId)
      if (slide)
        slide.layers = slide.layers.filter(
          (layer) =>
            layer.id !== previous.layer.id ||
            JSON.stringify(layer) !== JSON.stringify(previous.layer)
        )
    }
  }
  next.brandAssignment = assignment
  return storeGroupSchema.parse(next)
}

type StoreBrandField = {
  role: 'background' | 'palette' | 'heading' | 'subheading' | 'body'
  field?: string
  label: string
}
/** Local theme fields are independent overrides of the pinned workspace brand assignment. */
export function storeBrandOverrides(group: StoreGroup): StoreBrandField[] {
  const assigned = group.brandAssignment?.theme
  if (!assigned) return []
  const result: StoreBrandField[] = []
  for (const role of ['background', 'palette'] as const)
    if (JSON.stringify(group.document.theme[role]) !== JSON.stringify(assigned[role]))
      result.push({ role, label: role })
  for (const role of ['heading', 'subheading', 'body'] as const)
    for (const field of Object.keys(
      assigned.textStyles[role]
    ) as (keyof typeof assigned.textStyles.heading)[])
      if (
        JSON.stringify(group.document.theme.textStyles[role][field]) !==
        JSON.stringify(assigned.textStyles[role][field])
      )
        result.push({ role, field, label: `${role} · ${field}` })
  return result
}

export function resetStoreBrandField(group: StoreGroup, field: StoreBrandField): StoreGroup {
  if (
    !group.brandAssignment ||
    !storeBrandOverrides(group).some(
      (candidate) => candidate.role === field.role && candidate.field === field.field
    )
  )
    throw new Error('This brand override is no longer available.')
  const next = structuredClone(group),
    assigned = next.brandAssignment!.theme
  if (field.role === 'background')
    next.document.theme.background = structuredClone(assigned.background)
  else if (field.role === 'palette') next.document.theme.palette = [...assigned.palette]
  else {
    const key = field.field as keyof typeof assigned.textStyles.heading
    Object.assign(next.document.theme.textStyles[field.role], {
      [key]: structuredClone(assigned.textStyles[field.role][key]),
    })
  }
  return storeGroupSchema.parse(next)
}
