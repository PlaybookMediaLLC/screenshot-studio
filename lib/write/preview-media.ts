/** Retain media kinds from the selected Plate version for native preview elements. */
export function previewMediaTypes(body: unknown[]): Record<string, 'image' | 'video'> {
  const types: Record<string, 'image' | 'video'> = {}
  const visit = (nodes: unknown[]) => {
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as Record<string, unknown>
      if (typeof node.assetId === 'string' && (node.type === 'img' || node.type === 'video'))
        types[node.assetId] = node.type === 'video' ? 'video' : 'image'
      if (Array.isArray(node.children)) visit(node.children)
    }
  }
  visit(body)
  return types
}
