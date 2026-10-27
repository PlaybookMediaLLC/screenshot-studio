import type { PlateBody } from './document'

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
const postURL =
  /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status\/(\d{1,30})(?:[/?#].*)?$/
type Node = { type?: string; text?: string; children?: Node[]; [key: string]: unknown }

/** Serialize supported Plate article content without accepting raw HTML or external media. */
export function articleContent(body: PlateBody): { html: string; problems: string[] } {
  const problems: string[] = []
  const render = (node: Node): string => {
    if (typeof node.text === 'string') {
      let text = escape(node.text).replaceAll('\n', '<br>')
      if (node.bold) text = `<strong>${text}</strong>`
      if (node.italic) text = `<em>${text}</em>`
      if (node.strikethrough) text = `<s>${text}</s>`
      if (node.underline || node.code || node.color || node.highlight)
        problems.push(
          'Article text supports bold, italic and strikethrough. Remove other text styles before publishing.'
        )
      return text
    }
    const children = () => (node.children ?? []).map(render).join('')
    if (node.type === 'post_break') return ''
    if (node.type === 'img') {
      if (typeof node.assetId !== 'string') {
        problems.push('Upload every article image first.')
        return ''
      }
      return `<img data-asset-id="${escape(node.assetId)}" alt="${escape(String(node.alt ?? ''))}">`
    }
    const url = String(node.url ?? '')
    const embedded = postURL.exec(url)
    if (node.type === 'media_embed' && embedded)
      return `<blockquote data-x-post="${embedded[1]}"><a href="https://x.com/i/status/${embedded[1]}">Embedded X post</a></blockquote>`
    if (node.type === 'a') {
      if (!/^https?:\/\//i.test(url)) {
        problems.push('Article links must use HTTP or HTTPS.')
        return children()
      }
      return `<a href="${escape(url)}">${children()}</a>`
    }
    if (node.listStyleType)
      return `<${node.listStyleType === 'decimal' ? 'ol' : 'ul'}><li>${children()}</li></${node.listStyleType === 'decimal' ? 'ol' : 'ul'}>`
    if (['p', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li'].includes(node.type ?? 'p')) {
      const tag = node.type ?? 'p'
      return `<${tag}>${children()}</${tag}>`
    }
    problems.push(
      `The article contains an unsupported ${node.type ?? 'unknown'} block. Convert or remove it before publishing.`
    )
    return children()
  }
  return { html: (body as Node[]).map(render).join(''), problems: [...new Set(problems)] }
}
