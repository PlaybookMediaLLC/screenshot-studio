import { identifyLayers, creativeSetDocumentSchema, type StorySource } from './document'
import { createCreativeSet } from './recipes'
import { parseDesignDocument } from '@/lib/design/document'
import { resolvedDocumentHash } from './delivery'

/** Keep an exact native original alongside authored formats; the source project is never written. */
export async function copyProjectIntoSet(
  project: {
    id: string
    name: string
    revision: number
    document: unknown
    kind?: 'project' | 'file'
  },
  evidence: Pick<StorySource, 'width' | 'height'>,
  now = new Date(),
  newId = () => crypto.randomUUID()
) {
  const source = parseDesignDocument(project.document)
  if (!source.image.src?.startsWith('asset:'))
    throw new Error('Upload the project screenshot before copying it into a Story Set.')
  const document = identifyLayers(source, newId)
  const headline =
    document.texts.find((text) => text.role === 'headline' && text.visible !== false) ??
    document.texts.find((text) => text.visible !== false)
  const supporting = document.texts.find(
    (text) => text.role === 'body' && text.visible !== false && text.id !== headline?.id
  )
  const set = createCreativeSet(
    {
      headline: (headline?.text.trim() || project.name).slice(0, 300),
      supporting: (supporting?.text ?? '').slice(0, 300),
      source: {
        id: newId(),
        src: source.image.src,
        revision: 1,
        name: (source.image.name || project.name).slice(0, 200),
        ...evidence,
      },
      focus: { x: 0.25, y: 0.25, width: 0.3, height: 0.3 },
      treatment: 'product-hero',
    },
    newId
  )
  set.outputs.unshift({
    id: newId(),
    storyId: set.stories[0]!.id,
    kind: 'design',
    reusable: [],
    format: 'original',
    composition: { id: 'imported', version: 1 },
    origin: {
      kind: project.kind ?? 'project',
      id: project.id,
      revision: project.revision,
      copiedAt: now.toISOString(),
      documentHash: await resolvedDocumentHash(source),
    },
    bindings: {
      headline: headline?.id ?? newId(),
      supporting: supporting?.id ?? newId(),
      focus: newId(),
    },
    overrides: { headline: true, supporting: true, source: false, focus: true },
    review: { source: false, redactions: false, wording: false },
    document,
  })
  return creativeSetDocumentSchema.parse(set)
}
