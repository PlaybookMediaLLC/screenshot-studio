'use client'

import { useRef, useState } from 'react'
import { AnimationDialog } from '@/components/store-screenshots/studio/dialogs/AnimationDialog'
import { useRenderServices } from '@/components/store-screenshots/render/RenderProvider'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { assertStoreAssetsReady } from '@/lib/creative-sets/store-delivery'
import { resolvedDocumentHash } from '@/lib/creative-sets/delivery'
import type { CreativeSetSession } from '@/lib/creative-sets/session'
import type { CreativeSetDocument } from '@/lib/creative-sets/document'
import { DeliveredMotion, type MotionFile } from './DeliveredMotion'

export function StoreMotionDialog({
  session,
  groupId,
  flush,
  onClose,
}: {
  session: CreativeSetSession
  groupId: string
  flush: () => void
  onClose: () => void
}) {
  const { resolveAsset } = useRenderServices()
  const snapshot = useRef<{ document: CreativeSetDocument; revision: number } | null>(null)
  const [result, setResult] = useState<MotionFile | null>(null)
  const [saving, setSaving] = useState(false)
  if (!result)
    return (
      <AnimationDialog
        open
        strict
        onOpenChange={(open) => !open && onClose()}
        beforeExport={async (native) => {
          flush()
          if (!(await session.save())) throw new Error('Save this set before rendering motion.')
          const state = session.snapshot(),
            group = state.document.storeGroups.find((group) => group.id === groupId)
          if (!group || group.review.source)
            throw new Error('Review the changed store screenshots before rendering.')
          if (JSON.stringify(group.document) !== JSON.stringify(native))
            throw new Error(
              'Assets changed during saving. Reopen motion to render the saved composition.'
            )
          await assertStoreAssetsReady(native, resolveAsset)
          await session.client.creativeSet.createVersion.mutate({
            creativeSetId: session.record.id,
            name: `Delivery revision ${state.revision}`,
            baseRevision: state.revision,
          })
          snapshot.current = { document: structuredClone(state.document), revision: state.revision }
        }}
        onExport={async (file, signal) => {
          signal.throwIfAborted()
          const state = snapshot.current!,
            group = state.document.storeGroups.find((group) => group.id === groupId)!
          const manifest = {
            id: crypto.randomUUID(),
            revision: state.revision,
            outputId: group.id,
            fileName: `${group.id.slice(0, 8)}-r${state.revision}-${file.fileName}`,
            documentHash: await resolvedDocumentHash(file.document),
            sources: [...new Set(Object.values(group.assetMap))],
            brand: state.document.brand
              ? { id: state.document.brand.id, version: state.document.brand.version }
              : null,
            composition: { id: group.document.templateId, version: group.document.version },
            store: {
              slideId: '*',
              slideIds: file.document.slides.map((slide) => slide.id),
              targetId: file.presetId,
              locale: file.locale,
              width: file.width,
              height: file.height,
            },
          }
          signal.throwIfAborted()
          setResult({ blob: file.blob, manifest, url: URL.createObjectURL(file.blob) })
        }}
      />
    )
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle>Deliver store motion</DialogTitle>
        <DialogDescription>
          Review the exact animation from revision {result.manifest.revision}. Its manifest records
          every source slide.
        </DialogDescription>
        <DeliveredMotion session={session} result={result} onBusyChange={setSaving} />
      </DialogContent>
    </Dialog>
  )
}
