import { bodyPosts } from './versions'
import type { PlateBody, PlatformVersions } from './document'

/** Match a discussion's stable post or captured text without moving it to another post. */
export function commentAnchorExists(
  thread: {scope?: unknown; platform?: unknown; postId?: unknown; documentContent?: unknown},
  primary: PlateBody,
  versions: PlatformVersions,
  primaryPlatform: string
): boolean {
  if (thread.scope === 'draft') return true
  if (thread.scope !== 'post' && thread.scope !== 'text') return false
  let body = primary
  if (thread.platform !== primaryPlatform) {
    const version = versions.versions.find((version) => version.channel === thread.platform)
    if (!version) return false
    if (version.mode === 'manual') body = version.body ?? []
  }
  const post = bodyPosts(body).find((post) => post.id === thread.postId)
  if (!post) return false
  if (thread.scope === 'post') return true
  const plain = (node: unknown): string => {
    if (Array.isArray(node)) return node.map(plain).join('')
    if (!node || typeof node !== 'object') return ''
    const value = node as Record<string, unknown>
    if (typeof value.text === 'string') return value.text
    if (value.type === 'mention' && typeof value.value === 'string') return `@${value.value}`
    return plain(value.children)
  }
  const text = post.blocks.map(plain).join('\n')
  return typeof thread.documentContent === 'string' && !!thread.documentContent && text.split(thread.documentContent).length === 2
}
