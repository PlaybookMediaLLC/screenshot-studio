'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import JSZip from 'jszip'
import { Button } from '@/components/ui/button'
import { deliverySchema } from '@/lib/creative-sets/document'
import { downloadBlob } from '@/lib/creative-sets/delivery'
import { saveExportToWorkspace } from '@/lib/workspace/save-export'
import type { CreativeSetSession } from '@/lib/creative-sets/session'

export type MotionFile = {
  blob: Blob
  manifest: z.infer<typeof deliverySchema>
  url: string
  asset?: string
}

/** Both native engines deliver the reviewed bytes and their immutable source revision. */
export function DeliveredMotion({
  session,
  result,
  onBusyChange,
}: {
  session: CreativeSetSession
  result: MotionFile
  onBusyChange: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string | null>(null)
  useEffect(() => () => URL.revokeObjectURL(result.url), [result])
  async function deliver(save: boolean) {
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      if (save) {
        if (!result.asset) {
          const asset = await saveExportToWorkspace({
            blob: result.blob,
            fileName: result.manifest.fileName,
            trpcClient: session.client,
          })
          result.asset = `asset:${asset.assetId}`
        }
        const document = structuredClone(session.snapshot().document)
        if (!document.deliveries.some((item) => item.id === result.manifest.id))
          document.deliveries.push({ ...result.manifest, asset: result.asset })
        session.commit(document, false)
        if (!(await session.save()))
          throw new Error(
            'File uploaded. Resolve the save conflict and retry to retain its delivery record.'
          )
        setSaved(true)
      } else {
        const zip = new JSZip().file(result.manifest.fileName, result.blob).file(
          'manifest.json',
          JSON.stringify(
            {
              setId: session.record.id,
              revision: result.manifest.revision,
              outputs: [result.manifest],
            },
            null,
            2
          )
        )
        downloadBlob(
          await zip.generateAsync({ type: 'blob' }),
          `story-motion-r${result.manifest.revision}.zip`
        )
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Delivery failed.')
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  return (
    <div className="space-y-3">
      {result.blob.type === 'image/gif' ? (
        <img src={result.url} alt="Rendered animation" className="max-h-96 w-full object-contain" />
      ) : (
        <video controls src={result.url} className="max-h-96 w-full" />
      )}
      <p className="text-xs">{result.manifest.fileName}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy || saved} onClick={() => void deliver(true)}>
          {saved ? 'Saved to assets' : 'Save to workspace assets'}
        </Button>
        <Button disabled={busy} onClick={() => void deliver(false)}>
          Download video ZIP
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
