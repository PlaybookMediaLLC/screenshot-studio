import { creativeSetDocumentSchema, materializeOutput, type CreativeSetDocument } from './document'
import { materializeStoreGroup } from './store'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const key = (value: unknown): string | undefined => {
  if (!object(value)) return undefined
  if (typeof value.id === 'string') return value.id
  if (
    typeof value.slideId === 'string' &&
    typeof value.layerId === 'string' &&
    typeof value.field === 'string'
  )
    return `${value.slideId}:${value.layerId}:${value.field}`
}

export class ConcurrentEditError extends Error {
  constructor(readonly field: string) {
    super(
      `Another editor changed the same field (${field}). Keep your work as a copy or load the saved version.`
    )
    this.name = 'ConcurrentEditError'
  }
}

/** Merge independent fields, refusing overlapping edits rather than choosing a winner. */
export function mergeConcurrent(
  base: unknown,
  local: unknown,
  remote: unknown,
  path = 'set'
): unknown {
  if (same(local, remote) || same(base, remote)) return structuredClone(local)
  if (same(base, local)) return structuredClone(remote)
  if (object(base) && object(local) && object(remote)) {
    const result: Record<string, unknown> = {}
    for (const name of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const value = mergeConcurrent(base[name], local[name], remote[name], `${path}.${name}`)
      if (value !== undefined) result[name] = value
    }
    return result
  }
  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(remote) &&
    [base, local, remote].every(
      (items) =>
        items.every((item) => key(item) !== undefined) &&
        new Set(items.map(key)).size === items.length
    )
  ) {
    const maps = [base, local, remote].map(
      (items) => new Map(items.map((item) => [key(item)!, item]))
    )
    const [b, l, r] = maps as [Map<string, unknown>, Map<string, unknown>, Map<string, unknown>]
    const values = new Map<string, unknown>()
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const value = mergeConcurrent(b.get(id), l.get(id), r.get(id), `${path}[${id}]`)
      if (value !== undefined) values.set(id, value)
    }
    const survivingBase = [...b.keys()].filter((id) => values.has(id))
    const orderOf = (map: Map<string, unknown>) =>
      [...map.keys()].filter((id) => survivingBase.includes(id))
    const localOrder = orderOf(l),
      remoteOrder = orderOf(r)
    const localReordered = !same(localOrder, survivingBase)
    const remoteReordered = !same(remoteOrder, survivingBase)
    if (localReordered && remoteReordered && !same(localOrder, remoteOrder))
      throw new ConcurrentEditError(`${path}.order`)
    const preferred = localReordered ? l : r
    const other = localReordered ? r : l
    const order = [...preferred.keys()].filter((id) => values.has(id))
    const additions = [...other.keys()].filter((id) => values.has(id))
    for (let index = 0; index < additions.length; index++) {
      const id = additions[index]!
      if (order.includes(id)) continue
      const previous = additions
        .slice(0, index)
        .reverse()
        .find((candidate) => order.includes(candidate))
      const following = additions.slice(index + 1).find((candidate) => order.includes(candidate))
      order.splice(
        previous
          ? order.indexOf(previous) + 1
          : following
            ? order.indexOf(following)
            : order.length,
        0,
        id
      )
    }
    return order.map((id) => values.get(id))
  }
  throw new ConcurrentEditError(path)
}

/** Shared values, not their materialized copies, participate in concurrency decisions. */
function authoritative(set: CreativeSetDocument): unknown {
  const next = structuredClone(set)
  const omit = (value: object, ...fields: string[]) => {
    for (const field of fields) delete (value as Record<string, unknown>)[field]
  }
  for (const output of next.outputs) {
    for (const field of ['headline', 'supporting'] as const) {
      const text = output.document.texts.find((layer) => layer.id === output.bindings[field])
      if (text && !output.overrides[field]) omit(text, 'text', 'visible')
    }
    if (!output.overrides.source) omit(output.document.image, 'src')
    const focus = output.document.elements.find((layer) => layer.id === output.bindings.focus)
    if (focus?.type === 'callout' && !output.overrides.focus) omit(focus.props, 'source', 'zoom')
  }
  for (const group of next.storeGroups)
    for (const binding of group.bindings) {
      if (binding.overridden) continue
      const layer = group.document.slides
        .find((slide) => slide.id === binding.slideId)
        ?.layers.find((layer) => layer.id === binding.layerId)
      if (!layer) continue
      if (layer.type === 'text' && (binding.field === 'headline' || binding.field === 'supporting'))
        for (const span of layer.content) span.text = ''
      if (binding.field === 'focus' && layer.type === 'callout') omit(layer, 'region')
      if (binding.field === 'source' && binding.assetId) {
        delete group.assetMap[binding.assetId]
        const asset = group.document.assets[binding.assetId]
        if (asset) omit(asset, 'name', 'width', 'height', 'src')
      }
    }
  return next
}

export function mergeSetConcurrent(
  base: CreativeSetDocument,
  local: CreativeSetDocument,
  remote: CreativeSetDocument
): CreativeSetDocument {
  if (same(local, remote) || same(base, remote)) return structuredClone(local)
  if (same(base, local)) return structuredClone(remote)
  const merged = mergeConcurrent(
    authoritative(base),
    authoritative(local),
    authoritative(remote)
  ) as CreativeSetDocument
  const copyChanged = (storyId: string, field: 'headline' | 'supporting') =>
    base.stories.find((story) => story.id === storyId)?.[field] !==
    merged.stories.find((story) => story.id === storyId)?.[field]
  for (const output of merged.outputs) {
    output.document = materializeOutput(merged, output)
    if (
      ['headline', 'supporting'].some(
        (field) =>
          output.overrides[field as 'headline' | 'supporting'] &&
          copyChanged(output.storyId, field as 'headline' | 'supporting')
      )
    )
      output.review.wording = true
  }
  merged.storeGroups = merged.storeGroups.map((group) => {
    for (const binding of group.bindings) {
      if (binding.overridden || (binding.field !== 'headline' && binding.field !== 'supporting'))
        continue
      const story = merged.stories.find((story) => story.id === binding.storyId)
      const layer = group.document.slides
        .find((slide) => slide.id === binding.slideId)
        ?.layers.find((layer) => layer.id === binding.layerId)
      if (!story || layer?.type !== 'text') continue
      for (const source of [local, remote, base]) {
        const original = source.storeGroups
          .find((item) => item.id === group.id)
          ?.document.slides.find((slide) => slide.id === binding.slideId)
          ?.layers.find((item) => item.id === binding.layerId)
        if (
          original?.type === 'text' &&
          original.content.map((span) => span.text).join('') === story[binding.field] &&
          same(
            original.content.map((span) => ({ ...span, text: '' })),
            layer.content
          )
        ) {
          layer.content = structuredClone(original.content)
          break
        }
      }
    }
    const resolved = materializeStoreGroup(merged, group)
    resolved.review.source = group.review.source
    if (
      group.bindings.some(
        (binding) =>
          binding.overridden &&
          (binding.field === 'headline' || binding.field === 'supporting') &&
          copyChanged(binding.storyId, binding.field)
      )
    )
      resolved.review.wording = true
    return resolved
  })
  return creativeSetDocumentSchema.parse(merged)
}
