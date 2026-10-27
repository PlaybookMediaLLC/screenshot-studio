import { type DesignChanges, type DesignDocument, patchDesignDocument } from './document'

/**
 * Applying changes written against the AI view of a design. The model sees
 * that view (no hidden layers, no layers with local images), and a list it
 * sends replaces the whole list. Without care, an edit to "the overlays"
 * would delete the hidden ones and the logo it never saw, and device
 * screens would lose their images (the model may not set image sources).
 */

type Layer = { id?: string }

/** `next` plus the `base` layers the model never saw and did not keep. */
function keepUnseen<T extends Layer>(
  base: readonly T[],
  seen: readonly Layer[],
  next: readonly T[]
): T[] {
  const seenIds = new Set(seen.map((item) => item.id).filter(Boolean))
  const nextIds = new Set(next.map((item) => item.id).filter(Boolean))
  const unseen = base.filter((item) => item.id && !seenIds.has(item.id) && !nextIds.has(item.id))
  return unseen.length ? [...next, ...unseen] : [...next]
}

/**
 * `base` (the lossless design) patched with `changes` written against
 * `view` (what the model saw). Lists the changes replace keep the layers the
 * model could not see, and device screens keep their images.
 */
export function patchFromModel(
  base: DesignDocument,
  view: DesignDocument,
  changes: DesignChanges
): DesignDocument {
  const merged = patchDesignDocument(base, changes)
  const result: DesignDocument = { ...merged }
  if ('texts' in changes) result.texts = keepUnseen(base.texts, view.texts, merged.texts)
  if ('overlays' in changes)
    result.overlays = keepUnseen(base.overlays, view.overlays, merged.overlays)
  if ('annotations' in changes) {
    result.annotations = keepUnseen(base.annotations, view.annotations, merged.annotations)
  }
  if ('redactions' in changes)
    result.redactions = keepUnseen(base.redactions, view.redactions, merged.redactions)
  if ('elements' in changes)
    result.elements = keepUnseen(base.elements, view.elements, merged.elements)
  if (changes.devices && merged.devices && base.devices) {
    const screens = new Map(base.devices.mockups.map((mockup) => [mockup.id, mockup.screen]))
    const mockups = merged.devices.mockups.map((mockup) => {
      const original = mockup.id ? screens.get(mockup.id) : undefined
      return original && !mockup.screen.src
        ? { ...mockup, screen: { ...mockup.screen, name: original.name, src: original.src } }
        : mockup
    })
    result.devices = {
      ...merged.devices,
      mockups: keepUnseen(base.devices.mockups, view.devices?.mockups ?? [], mockups),
    }
  }
  return result
}
