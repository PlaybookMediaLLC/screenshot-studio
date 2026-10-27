import type { DesignDocument } from '@/lib/design/document'

/** A project with no visual content needs an empty-state card, not a rendered thumbnail. */
export function isEmptyProject(document: DesignDocument): boolean {
  return !(
    document.image.src ||
    document.template ||
    document.background?.type === 'image' ||
    document.pattern?.enabled ||
    document.texts.length ||
    document.overlays.length ||
    document.elements.length ||
    document.annotations.length ||
    document.redactions.length ||
    document.devices?.mockups.length ||
    document.devices?.layoutId ||
    document.slides?.items.length
  )
}
