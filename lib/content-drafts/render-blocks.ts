import type { EditorUploadFile } from '@shots/platejs-editor/lib'
import { domToBlob } from 'modern-screenshot'
import type { BlockImages } from '@/lib/content-drafts/serialize'

/**
 * Table and math blocks as images (RFC 037). Social channels take no tables
 * or LaTeX, so at scheduling the composer renders each block as it looks in
 * the editor, in body order, and stores it as a workspace asset. A block that
 * fails to render posts as text.
 */
export async function renderBlockImages(
  root: HTMLElement,
  upload: EditorUploadFile
): Promise<BlockImages> {
  const blocks = root.querySelectorAll<HTMLElement>('.slate-table, .slate-equation')
  const images: BlockImages = []
  for (const [index, block] of blocks.entries()) {
    try {
      // The block keeps the editor's layout; the image ends where the table or
      // the typeset formula does, not at the full editor width.
      const content = block.querySelector<HTMLElement>('table, .katex') ?? block
      const box = block.getBoundingClientRect()
      const blob = await domToBlob(block, {
        backgroundColor: backgroundOf(block),
        height: box.height + 2 * PADDING,
        scale: 2,
        style: { margin: `${PADDING}px` },
        type: 'image/png',
        width: content.getBoundingClientRect().right - box.left + 2 * PADDING,
      })
      const stored = await upload(new File([blob], `block-${index + 1}.png`, { type: 'image/png' }))
      images.push(stored.assetId ?? null)
    } catch {
      images.push(null)
    }
  }
  return images
}

/** Room around a rendered block, in CSS pixels. */
const PADDING = 24

/**
 * The color the block is seen on: the first opaque ancestor background, or,
 * when the page paints it elsewhere, dark behind light text and white behind
 * dark text.
 */
function backgroundOf(element: HTMLElement): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (rgba(color)[3] === 255) return color
  }
  const [red, green, blue] = rgba(getComputedStyle(element).color)
  return 0.299 * red + 0.587 * green + 0.114 * blue > 128 ? '#0a0a0a' : '#ffffff'
}

/** Any CSS color (rgb, oklch, …) as RGBA bytes, read back from a canvas. */
function rgba(color: string): Uint8ClampedArray {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return new Uint8ClampedArray([0, 0, 0, 0])
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  return context.getImageData(0, 0, 1, 1).data
}
