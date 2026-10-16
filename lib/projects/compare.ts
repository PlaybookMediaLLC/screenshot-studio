import type { DesignDocument } from '@/lib/design/document'

const SECTION_LABELS: Record<string, string> = {
  animation: 'Animation',
  annotations: 'Annotations',
  background: 'Background',
  canvas: 'Canvas',
  devices: 'Devices',
  elements: 'Elements',
  image: 'Screenshot',
  mode: 'Mode',
  overlays: 'Overlays',
  pattern: 'Pattern',
  redactions: 'Redactions',
  slides: 'Slides',
  template: 'Template',
  texts: 'Text',
  timeline: 'Timeline',
}

/** The reader-facing name of a document section; unknown sections read as their key. */
export function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section.charAt(0).toUpperCase() + section.slice(1)
}

/**
 * The sections that differ between two documents, for comparing a version
 * with the current design. Both documents come out of the same schema, so
 * their keys are in the same order and a JSON comparison per section is exact.
 */
export function changedSections(before: DesignDocument, after: DesignDocument): string[] {
  const sections = new Set([...Object.keys(before), ...Object.keys(after)])
  sections.delete('version')
  const value = (document: DesignDocument, key: string) =>
    JSON.stringify((document as Record<string, unknown>)[key] ?? null)
  return [...sections].filter((key) => value(before, key) !== value(after, key))
}
