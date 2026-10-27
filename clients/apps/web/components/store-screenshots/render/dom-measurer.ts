import type { MeasureRequest, MeasureResult, TextMeasurer } from '@/lib/store-screenshots/engine/text'
import { spanStyle, textBlockStyle } from './text-style'

/**
 * Measures text with the browser's own layout, using the renderer's CSS, so
 * the layout engine reserves exactly the space the text will paint. Results
 * are cached; `clear` is called when web fonts finish loading.
 */

const CACHE_LIMIT = 4000

/** A DOM-backed measurer with a cache. */
export type DomMeasurer = { measure: TextMeasurer; clear: () => void }

function applyStyle(element: HTMLElement, style: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue
    ;(element.style as unknown as Record<string, string>)[key] = String(value)
  }
}

/** Create a measurer attached to `document.body`. */
export function createDomMeasurer(): DomMeasurer {
  const cache = new Map<string, MeasureResult>()
  let host: HTMLDivElement | null = null
  let block: HTMLDivElement | null = null

  const ensureHost = (): HTMLDivElement => {
    if (host && block && host.isConnected) return block
    host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.setAttribute('data-store-text-measurer', '')
    Object.assign(host.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      contain: 'layout style',
    })
    block = document.createElement('div')
    host.appendChild(block)
    document.body.appendChild(host)
    return block
  }

  const measure: TextMeasurer = (request: MeasureRequest) => {
    const key = JSON.stringify([
      request.content,
      request.style,
      Math.round(request.fontSizePx * 100) / 100,
      Math.round(request.widthPx * 10) / 10,
      request.direction,
    ])
    const cached = cache.get(key)
    if (cached) return cached
    const element = ensureHost()
    element.removeAttribute('style')
    element.replaceChildren()
    applyStyle(element, textBlockStyle(request.style, request.fontSizePx, '#000', request.direction) as Record<string, unknown>)
    element.style.width = `${request.widthPx}px`
    element.style.display = 'block'
    for (const span of request.content) {
      const node = document.createElement('span')
      node.textContent = span.text
      applyStyle(node, spanStyle(span, request.style) as Record<string, unknown>)
      element.appendChild(node)
    }
    if (!element.textContent) element.textContent = '​'
    const height = element.getBoundingClientRect().height
    const range = document.createRange()
    range.selectNodeContents(element)
    const rects = Array.from(range.getClientRects())
    const left = Math.min(...rects.map((rect) => rect.left))
    const right = Math.max(...rects.map((rect) => rect.right))
    const width = rects.length ? right - left : 0
    const lineHeightPx = request.style.lineHeight * request.fontSizePx
    const result: MeasureResult = {
      width: Math.min(width, request.widthPx),
      height,
      lines: Math.max(1, Math.round(height / lineHeightPx)),
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(key, result)
    return result
  }

  return {
    measure,
    clear: () => cache.clear(),
  }
}
