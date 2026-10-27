import { getStoreTarget } from '../targets'
import type { PlannedFile } from './plan'

/**
 * Runs an export plan: renders files one at a time (rendering uses the main
 * thread's DOM, so parallelism would only contend), checks each result
 * against the store's file limits, and stops between files when cancelled.
 */

/** A rendered file. */
export type ExportOutput = { file: PlannedFile; blob: Blob }

/** A file that could not be produced. */
export type ExportFailure = { file: PlannedFile; reason: string }

/** Job progress. */
export type ExportProgress = { done: number; total: number; current: PlannedFile | null }

/** Raised when the user cancels a running export. */
export class ExportCancelledError extends Error {
  /** Create a cancellation error. */
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

/** Render every planned file. Throws `ExportCancelledError` if `signal` aborts. */
export async function runExportJob(
  files: PlannedFile[],
  render: (file: PlannedFile, signal: AbortSignal) => Promise<Blob>,
  options: { signal: AbortSignal; onProgress?: (progress: ExportProgress) => void }
): Promise<{ outputs: ExportOutput[]; failures: ExportFailure[] }> {
  const outputs: ExportOutput[] = []
  const failures: ExportFailure[] = []
  for (const [index, file] of files.entries()) {
    if (options.signal.aborted) throw new ExportCancelledError()
    options.onProgress?.({ done: index, total: files.length, current: file })
    try {
      const blob = await render(file, options.signal)
      const limit = getStoreTarget(file.targetId)?.maxFileBytes
      if (limit && blob.size > limit) {
        failures.push({ file, reason: `${(blob.size / 1024 / 1024).toFixed(1)} MB is over the ${(limit / 1024 / 1024).toFixed(0)} MB limit. Export as JPEG instead.` })
      } else {
        outputs.push({ file, blob })
      }
    } catch (cause) {
      if (options.signal.aborted) throw new ExportCancelledError()
      failures.push({ file, reason: cause instanceof Error ? cause.message : 'Rendering failed.' })
    }
  }
  options.onProgress?.({ done: files.length, total: files.length, current: null })
  return { outputs, failures }
}

/** Package outputs into a ZIP, preserving their planned paths. */
export async function zipOutputs(outputs: ExportOutput[], signal: AbortSignal): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const output of outputs) zip.file(output.file.path, new Uint8Array(await output.blob.arrayBuffer()), { binary: true })
  if (signal.aborted) throw new ExportCancelledError()
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  if (signal.aborted) throw new ExportCancelledError()
  return blob
}
