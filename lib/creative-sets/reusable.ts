import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import {
  creativeSetDocumentSchema,
  materializeOutput,
  type CreativeOutput,
  type CreativeSetDocument,
} from './document'
import { mergeAssigned } from './merge-assigned'
import { reusableDefinitionSchema, type ReusableDefinition } from './reusable-schema'

/** Publish editable native layers with named roles; each stored template row is an immutable version. */
export function reusableDefinition(
  output: CreativeOutput,
  scope: ReusableDefinition['scope'],
  name?: string
): ReusableDefinition {
  const reference = output.reusable.find(
    (reference) => reference.scope === scope && reference.name === name
  )
  const ids = Object.fromEntries(
    Object.entries(reference?.ids ?? {}).map(([published, local]) => [local, published])
  )
  const slots = Object.fromEntries(
    Object.entries(output.bindings).map(([role, id]) => [role, ids[id] ?? id])
  )
  return reusableDefinitionSchema.parse({
    kind: 'story-reusable',
    version: 1,
    scope,
    format: output.format,
    slots,
    document: remapDocument(output.document, ids),
  })
}

function remapDocument(document: DesignDocument, ids: Record<string, string>): DesignDocument {
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string' && (key === 'id' || key.endsWith('Id')) && ids[value])
      return ids[value]
    if (Array.isArray(value)) return value.map((item) => visit(item))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, value]) => [key, visit(value, key)])
      )
    return value
  }
  return designDocumentSchema.parse(visit(document))
}

function scoped(
  base: DesignDocument,
  proposed: DesignDocument,
  output: CreativeOutput,
  scope: ReusableDefinition['scope']
): DesignDocument {
  if (scope === 'composition') return proposed
  const next = structuredClone(base)
  if (scope === 'headline') {
    next.texts = [
      ...next.texts.filter((text) => text.id !== output.bindings.headline),
      ...proposed.texts.filter((text) => text.id === output.bindings.headline),
    ]
  } else {
    next.elements = [
      ...next.elements.filter((layer) => layer.id !== output.bindings.focus),
      ...proposed.elements.filter((layer) => layer.id === output.bindings.focus),
    ]
  }
  return next
}

/** Preview/adopt a version in one transaction; local fields, placement, additions and deletions survive updates. */
export function applyReusable(
  set: CreativeSetDocument,
  outputId: string,
  template: { id: string; name: string; version: number; definition: unknown },
  reset = false
): CreativeSetDocument {
  const definition = reusableDefinitionSchema.parse(template.definition)
  const next = structuredClone(set)
  const output = next.outputs.find((output) => output.id === outputId)
  if (!output) throw new Error('This output no longer exists.')
  if (output.format !== definition.format)
    throw new Error('Choose a published treatment authored for this format.')
  const previous = output.reusable.find((reference) => reference.scope === definition.scope)
  const updating = previous?.name === template.name
  const ids = updating ? { ...previous.ids } : {}
  for (const role of ['headline', 'supporting', 'focus'] as const)
    ids[definition.slots[role]] = output.bindings[role]
  for (const layers of [
    definition.document.texts,
    definition.document.elements,
    definition.document.overlays,
    definition.document.annotations,
    definition.document.redactions,
  ])
    for (const layer of layers) if (layer.id && !ids[layer.id]) ids[layer.id] = crypto.randomUUID()
  const remapped = remapDocument(definition.document, ids)
  // Content and evidence belong to the story or its explicit local exceptions, not the template sample.
  for (const role of ['headline', 'supporting'] as const) {
    const current = output.document.texts.find((text) => text.id === output.bindings[role])
    const target = remapped.texts.find((text) => text.id === output.bindings[role])
    if (current && target) {
      target.text = current.text
      target.visible = current.visible
    }
  }
  remapped.image.src = output.document.image.src
  const assigned = scoped(
    updating ? previous.assigned : output.document,
    remapped,
    output,
    definition.scope
  )
  output.document = designDocumentSchema.parse(
    updating && !reset
      ? mergeAssigned(previous.assigned, output.document, assigned)
      : scoped(output.document, assigned, output, definition.scope)
  )
  output.reusable = [
    ...output.reusable.filter((reference) => reference.scope !== definition.scope),
    {
      id: template.id,
      name: template.name,
      version: template.version,
      scope: definition.scope,
      ids,
      assigned,
    },
  ]
  if (definition.scope === 'composition')
    output.composition = { id: template.id, version: template.version }
  output.document = materializeOutput(next, output)
  return creativeSetDocumentSchema.parse(next)
}

/** Detach preserves every rendered/native value and stops future update offers. */
export function detachReusable(
  set: CreativeSetDocument,
  outputId: string,
  scope: ReusableDefinition['scope']
) {
  const next = structuredClone(set)
  const output = next.outputs.find((output) => output.id === outputId)
  if (!output) throw new Error('This output no longer exists.')
  output.reusable = output.reusable.filter((reference) => reference.scope !== scope)
  return creativeSetDocumentSchema.parse(next)
}

type ReusableField = {
  owner: 'headline' | 'proof' | 'background' | 'product'
  path: string[]
  label: string
}
function roleValue(
  output: CreativeOutput,
  document: DesignDocument,
  owner: ReusableField['owner']
): object | undefined {
  if (owner === 'headline')
    return document.texts.find((text) => text.id === output.bindings.headline)
  if (owner === 'proof')
    return document.elements.find((layer) => layer.id === output.bindings.focus)
  return owner === 'background' ? document.background : document.image
}

/** Field resets affect one named role's style or placement; content keeps its story scope. */
export function reusableOverrides(
  output: CreativeOutput,
  scope: ReusableDefinition['scope']
): ReusableField[] {
  const reference = output.reusable.find((reference) => reference.scope === scope)
  if (!reference) return []
  const result: ReusableField[] = []
  const owners: ReusableField['owner'][] =
    scope === 'headline'
      ? ['headline']
      : scope === 'proof-detail'
        ? ['proof']
        : ['headline', 'proof', 'background', 'product']
  for (const owner of owners) {
    const assigned = roleValue(output, reference.assigned, owner),
      local = roleValue(output, output.document, owner)
    if (!assigned || !local) continue
    const walk = (before: unknown, current: unknown, path: string[]) => {
      if (JSON.stringify(before) === JSON.stringify(current)) return
      if (
        before &&
        current &&
        typeof before === 'object' &&
        typeof current === 'object' &&
        !Array.isArray(before) &&
        !Array.isArray(current)
      ) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
          if (
            ['id', 'text', 'src', 'name', 'type', 'role', 'source', 'zoom'].includes(key) ||
            (owner === 'headline' && key === 'visible')
          )
            continue
          walk(
            (before as Record<string, unknown>)[key],
            (current as Record<string, unknown>)[key],
            [...path, key]
          )
        }
      } else if (path.length)
        result.push({
          owner,
          path,
          label: `${owner === 'proof' ? 'Proof detail' : owner[0]!.toUpperCase() + owner.slice(1)} · ${path.filter((part) => part !== 'props').join(' · ')}`,
        })
    }
    walk(assigned, local, [])
  }
  return result
}

export function resetReusableField(
  set: CreativeSetDocument,
  outputId: string,
  scope: ReusableDefinition['scope'],
  field: ReusableField
): CreativeSetDocument {
  const next = structuredClone(set)
  const output = next.outputs.find((output) => output.id === outputId)
  const reference = output?.reusable.find((reference) => reference.scope === scope)
  if (
    !output ||
    !reference ||
    !reusableOverrides(output, scope).some(
      (candidate) =>
        candidate.owner === field.owner &&
        JSON.stringify(candidate.path) === JSON.stringify(field.path)
    )
  )
    throw new Error('This override is no longer available.')
  let source = roleValue(output, reference.assigned, field.owner) as Record<string, unknown>
  let target = roleValue(output, output.document, field.owner) as Record<string, unknown>
  for (const key of field.path.slice(0, -1)) {
    source = source[key] as Record<string, unknown>
    target = target[key] as Record<string, unknown>
  }
  const key = field.path.at(-1)!
  if (source[key] === undefined) delete target[key]
  else target[key] = structuredClone(source[key])
  output.document = materializeOutput(next, output)
  return creativeSetDocumentSchema.parse(next)
}
