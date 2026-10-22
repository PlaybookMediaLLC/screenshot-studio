/** Transient mention inputs are literal text at every persistence boundary. */
export function normalizeMentions<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeMentions) as T
  if (!value || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  if (node.type === 'mention_input') {
    const children = Array.isArray(node.children) ? node.children : []
    const text = typeof node.value === 'string' ? node.value : children.map((child) => child.text ?? '').join('')
    return { text: `${typeof node.trigger === 'string' ? node.trigger : '@'}${text}` } as T
  }
  return (Array.isArray(node.children) ? { ...node, children: node.children.map(normalizeMentions) } : node) as T
}
