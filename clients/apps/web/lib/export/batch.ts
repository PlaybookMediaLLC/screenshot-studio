import { z } from 'zod'
import type { DesignDocument } from '@/lib/design/document'
import { adaptDocumentToSize, documentCanvasSize, withoutBackground } from './adapt'
import { formatHasControl, type OutputFormat } from './formats'
import { batchEntryPath } from './naming'
import type { ExportTarget } from './sizes'
import type { ZipEntry } from './zip'

/**
 * Batch mode: one design applied to many screenshots.
 *
 * A batch item is a DesignDocument like any other: the style document with
 * its screenshot swapped for the item's, laid out again around the new
 * screenshot, and then adapted to each target size. So batch previews and
 * exports are drawn by the editor's one stage, exactly as the editor would
 * draw that design with that screenshot.
 */

/** The most screenshots one batch takes. */
export const MAX_BATCH_ITEMS = 50

/** Where a batch item is: waiting, being rendered, rendered, or failed. */
export const batchItemStatusSchema = z.enum(['pending', 'rendering', 'done', 'failed'])
/** A batch item's status. */
export type BatchItemStatus = z.infer<typeof batchItemStatusSchema>

/** Batch-wide switches over parts of the style; all on reproduces the style as designed. */
export const batchAdjustmentsSchema = z.object({
  /** Keep the style's background (off: transparent). */
  background: z.boolean(),
  /** Keep the style's window frame around the screenshot. */
  frame: z.boolean(),
  /** Keep the style's markup: arrows, shapes, blur regions, badges, cursors, callouts. */
  markup: z.boolean(),
  /** Keep the style's text layers. */
  text: z.boolean(),
})
/** Batch-wide adjustments. */
export type BatchAdjustments = z.infer<typeof batchAdjustmentsSchema>

/** Every part of the style kept. */
export const KEEP_WHOLE_STYLE: BatchAdjustments = {
  background: true,
  frame: true,
  markup: true,
  text: true,
}

/** The screenshot a batch item shows. */
export type BatchScreenshot = {
  /** Natural width / height, so layers on the screenshot can follow it. */
  aspect?: number
  /** File name, for the layer list and file names. */
  name: string
  /** A loadable reference: a `blob:` URL in the browser, or `asset:<id>`. */
  src: string
}

/**
 * The document for one batch item: `style` showing `screenshot` instead of
 * its own, with the batch-wide `adjustments`. Layers placed on the style's
 * screenshot are moved onto the new one (see `adaptDocumentToSize`) when
 * both aspects are known. Presets and brand kits are style documents too, so
 * any of them can be the style.
 */
export function composeBatchItem(
  style: DesignDocument,
  screenshot: BatchScreenshot,
  {
    adjustments = KEEP_WHOLE_STYLE,
    styleAspect,
  }: { adjustments?: BatchAdjustments; styleAspect?: number } = {}
): DesignDocument {
  const document: DesignDocument = {
    ...(adjustments.background ? style : withoutBackground(style)),
    // A batch item is one screenshot: the style's slides do not carry over.
    slides: undefined,
    image: { ...style.image, name: screenshot.name, src: screenshot.src },
    ...(adjustments.text ? {} : { texts: [] }),
    ...(adjustments.markup ? {} : { annotations: [], elements: [], redactions: [] }),
  }
  if (!adjustments.frame) {
    document.image = {
      ...document.image,
      frame: { color: '#ffffff', opacity: 1, padding: 0, type: 'none', width: 0 },
    }
  }
  return adaptDocumentToSize(document, documentCanvasSize(style), {
    imageAspect: screenshot.aspect,
    sourceImageAspect: styleAspect,
  })
}

/**
 * Run `work` over `items`, at most `limit` at a time, in order. Stops
 * starting new items once `signal` aborts; items already running get the
 * signal and finish or fail on their own. `work` handles its own errors: a
 * failed item must not stop the batch.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++
      await work(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane))
}

/** One rendered file of an item: one per size, or (PDF) one file with a page per size. */
export type BatchOutput = { blob: Blob; target?: ExportTarget }

/**
 * The ZIP entries of a batch. Paths are made now, from each item's place in
 * the list, so removing or retrying items never leaves gaps or clashes.
 */
export function batchZipEntries(
  items: readonly { name: string; outputs?: readonly BatchOutput[] }[],
  settings: { format: OutputFormat; scale: number }
): ZipEntry[] {
  return items.flatMap((item, index) =>
    (item.outputs ?? []).map((output) => ({
      data: output.blob,
      path: batchEntryPath({
        format: settings.format,
        index,
        name: item.name,
        scale: formatHasControl(settings.format, 'scale') ? settings.scale : 1,
        target: output.target,
        total: items.length,
      }),
    }))
  )
}

/** What a batch run changes on an item. */
export type BatchItemUpdate = {
  /** Sizes rendered so far. */
  done?: number
  error?: string
  outputs?: BatchOutput[]
  status?: BatchItemStatus
}

/**
 * Render `items`, `limit` at a time, reporting each item's progress through
 * `onUpdate`: rendering, sizes done, then done with its outputs or failed
 * with a readable reason. Items cut off by `signal` go back to pending.
 * Resolves false when the run was cancelled.
 */
export async function renderBatch<Item extends { id: string }>(
  items: readonly Item[],
  render: (
    item: Item,
    onSize: (done: number) => void,
    signal: AbortSignal
  ) => Promise<BatchOutput[]>,
  onUpdate: (id: string, update: BatchItemUpdate) => void,
  signal: AbortSignal,
  limit: number
): Promise<boolean> {
  await runPool(
    items,
    limit,
    async (item) => {
      onUpdate(item.id, { done: 0, error: undefined, outputs: undefined, status: 'rendering' })
      try {
        const outputs = await render(item, (done) => onUpdate(item.id, { done }), signal)
        onUpdate(item.id, { outputs, status: 'done' })
      } catch (error) {
        onUpdate(
          item.id,
          signal.aborted
            ? { done: 0, status: 'pending' }
            : {
                error: error instanceof Error ? error.message : 'The render failed.',
                status: 'failed',
              }
        )
      }
    },
    signal
  )
  return !signal.aborted
}
