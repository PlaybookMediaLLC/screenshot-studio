import type { PlateEditor } from '@shots/platejs-editor/platejs/react'
import type { TElement } from '@shots/platejs-editor/platejs'
import { PathApi } from '@shots/platejs-editor/platejs'

/** Find by identity at the time of an operation, never by a stale array index. */
export function attachmentEntry(editor: PlateEditor, id: string) {
  return [
    ...editor.api.nodes<TElement>({
      at: [],
      match: (node) => node.id === id && (node.type === 'img' || node.type === 'video'),
    }),
  ][0]
}

/** Move before a current position, retaining identity, nested media, history and comments. */
export function moveAttachment(editor: PlateEditor, id: string, before: number | number[]) {
  const entry = attachmentEntry(editor, id)
  if (!entry) return
  const destination = typeof before === 'number' ? [before] : before
  if (PathApi.equals(entry[1], destination)) return
  const to = PathApi.transform(destination, { type: 'remove_node', path: entry[1], node: entry[0] })
  if (to && !PathApi.equals(entry[1], to)) editor.tf.moveNodes({ at: entry[1], to })
}

/** Resolve both drag identities at drop time, including media inside imported containers. */
export function moveAttachmentRelative(
  editor: PlateEditor,
  id: string,
  neighborId: string,
  after = false
) {
  const neighbor = attachmentEntry(editor, neighborId)
  if (neighbor) moveAttachment(editor, id, after ? PathApi.next(neighbor[1]) : neighbor[1])
}

/** Copy durable media metadata; the copy gets its own node identity. */
export function copyAttachment(editor: PlateEditor, id: string, before: number) {
  const entry = attachmentEntry(editor, id)
  if (!entry) return
  const node = structuredClone(entry[0])
  node.id = crypto.randomUUID()
  // Discussion anchors belong to the original node; media descriptions and transforms do not.
  node.children = [{ text: '' }]
  editor.tf.insertNodes(node, { at: [before], select: false })
}

/** Refresh asset-scoped descriptions across all saved platform versions without changing IDs. */
export function withAssetDescription<T>(value: T, assetId: string, alt: string): T {
  if (Array.isArray(value))
    return value.map((item) => withAssetDescription(item, assetId, alt)) as T
  if (!value || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries({
      ...node,
      ...(node.type === 'img' && node.assetId === assetId ? { alt } : {}),
    }).map(([key, item]) => [key, withAssetDescription(item, assetId, alt)])
  ) as T
}
