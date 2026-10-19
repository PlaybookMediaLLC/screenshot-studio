'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { trackEvent } from '@/lib/analytics'
import { fetchDesignSources } from '@/lib/design/open-design'
import { getDesignAssetIds, mapDesignSources } from '@/lib/design/document'
import { renderDocument } from '@/lib/render/scene-renderer'
import {
  materializeOutput,
  outputDimensions,
  storyForOutput,
  type CreativeSetDocument,
  type CreativeOutput,
} from './document'

export function outputFileName(name: string, output: CreativeOutput, revision: number): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'story'
  const size = outputDimensions(output)
  const format = output.format
  return `${slug}-${format}-${size.width}x${size.height}-r${revision}.png`
}

/** A hash of the exact resolved native document before asset URLs become temporary local URLs. */
export async function resolvedDocumentHash(document: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function renderStoryOutput(
  client: TRPCClient<AppRouter>,
  set: CreativeSetDocument,
  output: CreativeOutput,
  name: string,
  revision: number,
  signal?: AbortSignal
) {
  if (output.review.source || output.review.redactions)
    throw new Error('Review the changed screenshot, focus, crop and redactions before delivery.')
  const native = materializeOutput(set, output)
  const size = outputDimensions(output)
  if (
    output.format !== 'original' &&
    (native.canvas?.size?.width !== size.width || native.canvas?.size?.height !== size.height)
  )
    throw new Error('Restore this format’s dimensions before delivery.')
  const sources = await fetchDesignSources(client, native)
  signal?.throwIfAborted()
  const document = mapDesignSources(native, (ref) => sources[ref] ?? ref)
  const started = performance.now()
  const capture = await renderDocument(
    document,
    { format: 'png', strict: true, scale: 1 },
    { signal }
  )
  if (capture.width !== size.width || capture.height !== size.height)
    throw new Error('The renderer returned unexpected dimensions.')
  trackEvent('story_set_output_rendered', {
    format: output.format,
    duration_ms: Math.round(performance.now() - started),
    revision,
  })
  return {
    ...capture,
    manifest: {
      id: crypto.randomUUID(),
      revision,
      outputId: output.id,
      fileName: outputFileName(
        `${name}-${storyForOutput(set, output).headline}-${output.storyId.slice(0, 8)}`,
        output,
        revision
      ),
      documentHash: await resolvedDocumentHash(native),
      sources: getDesignAssetIds(native).map((id) => `asset:${id}`),
      brand: set.brand ? { id: set.brand.id, version: set.brand.version } : null,
      composition: output.composition,
    },
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
