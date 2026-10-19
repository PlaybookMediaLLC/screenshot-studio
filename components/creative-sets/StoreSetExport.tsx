'use client'

import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ExportDialog } from '@/components/store-screenshots/studio/dialogs/ExportDialog'
import { useRenderServices } from '@/components/store-screenshots/render/RenderProvider'
import type { ExportOutput } from '@/lib/store-screenshots/export/job'
import { assertStoreAssetsReady, storeDeliveryManifest } from '@/lib/creative-sets/store-delivery'
import { downloadBlob } from '@/lib/creative-sets/delivery'
import { saveExportToWorkspace } from '@/lib/workspace/save-export'
import type { CreativeSetSession } from '@/lib/creative-sets/session'
import type { CreativeSetDocument } from '@/lib/creative-sets/document'

type FileResult = ExportOutput & {
  url: string
  manifest: Awaited<ReturnType<typeof storeDeliveryManifest>>[number]
  asset?: string
}

export function StoreSetExport({
  session,
  groupId,
  canSave,
  onClose,
}: {
  session: CreativeSetSession
  groupId: string
  canSave: boolean
  onClose: () => void
}) {
  const { resolveAsset } = useRenderServices()
  const [files, setFiles] = useState<FileResult[] | null>(null)
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string | null>(null)
  const snapshot = useRef<{ document: CreativeSetDocument; revision: number } | null>(null)
  const urls = useRef<string[]>([])
  useEffect(() => {
    const current = urls.current
    return () => current.forEach((url) => URL.revokeObjectURL(url))
  }, [])
  async function deliver(save: boolean) {
    if (!files || !snapshot.current) return
    setBusy(true)
    setError(null)
    try {
      if (save) {
        for (const file of files) {
          if (!file.asset) {
            const result = await saveExportToWorkspace({
              blob: file.blob,
              fileName: file.manifest.fileName.replaceAll('/', '-'),
              trpcClient: session.client,
            })
            file.asset = `asset:${result.assetId}`
          }
        }
        const document = structuredClone(session.snapshot().document)
        const known = new Set(document.deliveries.map((delivery) => delivery.id))
        document.deliveries.push(
          ...files
            .filter((file) => !known.has(file.manifest.id))
            .map((file) => ({ ...file.manifest, asset: file.asset }))
        )
        session.commit(document, false)
        if (!(await session.save()))
          throw new Error(
            'Files uploaded. Retry after resolving the save conflict to retain their delivery records.'
          )
        setSaved(true)
      } else {
        const zip = new JSZip()
        for (const file of files) zip.file(file.manifest.fileName, file.blob)
        zip.file(
          'manifest.json',
          JSON.stringify(
            {
              setId: session.record.id,
              revision: snapshot.current.revision,
              outputs: files.map((file) => file.manifest),
            },
            null,
            2
          )
        )
        downloadBlob(
          await zip.generateAsync({ type: 'blob' }),
          `story-set-store-r${snapshot.current.revision}.zip`
        )
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Delivery failed.')
    } finally {
      setBusy(false)
    }
  }
  if (!files)
    return (
      <ExportDialog
        open
        strict
        onOpenChange={(open) => !open && onClose()}
        beforeExport={async (native) => {
          if (canSave && !(await session.save())) throw new Error('Save this set before delivery.')
          const state = session.snapshot()
          if (canSave)
            await session.client.creativeSet.createVersion.mutate({
              creativeSetId: session.record.id,
              name: `Delivery revision ${state.revision}`,
              baseRevision: state.revision,
            })
          const group = state.document.storeGroups.find((group) => group.id === groupId)
          if (!group || group.review.source)
            throw new Error('Review changed store screenshots before delivery.')
          if (JSON.stringify(group.document) !== JSON.stringify(native))
            throw new Error(
              'Assets changed during saving. Reopen export to preview the saved composition.'
            )
          await assertStoreAssetsReady(native, resolveAsset)
          snapshot.current = { document: structuredClone(state.document), revision: state.revision }
        }}
        onExport={async (outputs, native, signal) => {
          signal.throwIfAborted()
          const state = snapshot.current!
          const group = state.document.storeGroups.find((group) => group.id === groupId)!
          const manifest = await storeDeliveryManifest(
            state.document,
            { ...group, document: native },
            state.revision,
            outputs
          )
          signal.throwIfAborted()
          setFiles(
            outputs.map((output, index) => {
              const url = URL.createObjectURL(output.blob)
              urls.current.push(url)
              return { ...output, url, manifest: manifest[index]! }
            })
          )
        }}
      />
    )
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl">
        <DialogTitle>Deliver store outputs</DialogTitle>
        <DialogDescription>
          Revision {snapshot.current?.revision}. These are the exact files, with their slide,
          language and target recorded.
        </DialogDescription>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {files.map((file) => (
            <article key={file.file.path} className="space-y-2 rounded border p-2">
              <a href={file.url} target="_blank" rel="noreferrer">
                <img src={file.url} alt={file.file.path} className="h-60 w-full object-contain" />
              </a>
              <p className="break-all text-xs">{file.manifest.fileName}</p>
              <p className="text-xs">
                {file.file.size.width} × {file.file.size.height}
              </p>
            </article>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {saved ? <p role="status">Saved new store files to workspace assets.</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setFiles(null)}>
            Change selection
          </Button>
          {canSave ? (
            <Button variant="outline" disabled={busy || saved} onClick={() => void deliver(true)}>
              Save to workspace assets
            </Button>
          ) : null}
          <Button disabled={busy} onClick={() => void deliver(false)}>
            Download ZIP
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
