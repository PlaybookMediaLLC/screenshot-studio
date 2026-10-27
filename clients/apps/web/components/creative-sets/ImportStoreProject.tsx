'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  listProjects,
  loadProject,
  type ProjectSummary,
} from '@/lib/store-screenshots/persistence/projects'
import { createScratchDocument } from '@/lib/store-screenshots/document/factory'
import { migrateStoreProject } from '@/lib/creative-sets/store-assets'
import type { CreativeSetSession } from '@/lib/creative-sets/session'

export function ImportStoreProject({
  session,
  onClose,
  onAdded,
}: {
  session: CreativeSetSession
  onClose: () => void
  onAdded: (id: string) => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const pending = useRef<{ source?: string; groupId: string } | null>(null)
  const verifiedUploads = useRef(new Map<string, string>())
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void listProjects()
      .then((projects) => {
        if (active) setProjects(projects)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [])
  async function add(id?: string) {
    setBusy(true)
    setError(null)
    try {
      if (!pending.current || pending.current.source !== id) {
        const document = id ? (await loadProject(id))?.document : createScratchDocument()
        if (!document) throw new Error('This local store project is no longer available.')
        const group = await migrateStoreProject(session.client, document, verifiedUploads.current)
        if (!id) delete group.origin
        session.command({ type: 'add-store', group })
        pending.current = { source: id, groupId: group.id }
      }
      if (!(await session.save()))
        throw new Error(
          'The copied group remains in local recovery. Resolve the save error before leaving this tab.'
        )
      onAdded(pending.current.groupId)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The store project could not be copied.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>Add store outputs</DialogTitle>
        <DialogDescription>
          Copy an editable store project from this browser, or start a new group. Every image and
          font is uploaded and verified; the local original remains available.
        </DialogDescription>
        <Button disabled={busy} onClick={() => void add()}>
          Create a store group
        </Button>
        <div className="max-h-80 space-y-2 overflow-auto">
          {projects.map((project) => (
            <Button
              className="w-full justify-start"
              variant="outline"
              key={project.id}
              disabled={busy}
              onClick={() => void add(project.id)}
            >
              {project.name} · {project.slideCount} slides
            </Button>
          ))}
        </div>
        {busy ? <p role="status">Copying and verifying workspace assets…</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
