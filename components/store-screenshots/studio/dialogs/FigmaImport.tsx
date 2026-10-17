'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { parseFigmaFileUrl } from '@/lib/integrations/figma-url'
import { cn } from '@/lib/utils'

/**
 * Import frames from a Figma file. The personal access token is sent once
 * over HTTPS to this app's server, which calls the Figma REST API and
 * returns rendered PNGs; the token is never stored or logged.
 */

type Frame = { id: string; name: string; page: string; width: number; height: number }

/** Figma frame picker inside the import dialog. */
export function FigmaImport({ onFiles }: { onFiles: (files: File[]) => void }): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [token, setToken] = React.useState('')
  const [frames, setFrames] = React.useState<Frame[]>([])
  const [picked, setPicked] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const parsed = parseFigmaFileUrl(url)

  const listFrames = async () => {
    if (!parsed) return
    setBusy('Loading frames…')
    try {
      const response = await fetch('/api/store-screenshots/figma/frames', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileKey: parsed.fileKey, token }),
      })
      const body = (await response.json()) as { frames?: Frame[]; error?: string }
      if (!response.ok || !body.frames) throw new Error(body.error ?? 'Figma did not return the file.')
      setFrames(body.frames)
      setPicked(body.frames.filter((frame) => frame.height > frame.width).slice(0, 10).map((frame) => frame.id))
    } catch (cause) {
      toast.error('Could not read the Figma file', { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const importFrames = async () => {
    if (!parsed) return
    const files: File[] = []
    for (const [index, id] of picked.entries()) {
      const frame = frames.find((item) => item.id === id)
      setBusy(`Rendering ${index + 1} of ${picked.length}…`)
      try {
        const response = await fetch('/api/store-screenshots/figma/image', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fileKey: parsed.fileKey, nodeId: id, token, scale: 2 }),
        })
        if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? 'Render failed')
        files.push(new File([await response.blob()], `${frame?.name ?? id}.png`, { type: 'image/png' }))
      } catch (cause) {
        toast.error(`Could not render “${frame?.name ?? id}”`, { description: cause instanceof Error ? cause.message : undefined })
      }
    }
    setBusy(null)
    if (files.length) onFiles(files)
  }

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-lg border border-foreground/10 p-3 text-xs">
      <summary className="cursor-pointer font-medium">Import frames from Figma</summary>
      <div className="mt-3 space-y-2">
        <label className="block space-y-1">
          <span className="text-muted-foreground">Figma file link</span>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.figma.com/design/…" className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 outline-none" />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">Personal access token (read-only file access is enough)</span>
          <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 outline-none" />
        </label>
        <p className="text-[10px] text-muted-foreground">The token is used for this import only and is not saved.</p>
        <button type="button" disabled={!parsed || token.length < 10 || Boolean(busy)} onClick={() => void listFrames()} className="h-8 rounded-md border border-foreground/15 px-2.5 disabled:opacity-40">
          List frames
        </button>
        {frames.length ? (
          <>
            <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Figma frames">
              {frames.map((frame) => (
                <li key={frame.id}>
                  <label className={cn('flex items-center gap-2 rounded px-1.5 py-1', picked.includes(frame.id) && 'bg-foreground/[0.05]')}>
                    <input type="checkbox" checked={picked.includes(frame.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, frame.id] : picked.filter((id) => id !== frame.id))} />
                    <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {frame.page} · {Math.round(frame.width)} × {Math.round(frame.height)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" disabled={picked.length === 0 || Boolean(busy)} onClick={() => void importFrames()} className="h-8 rounded-md bg-foreground px-2.5 text-background disabled:opacity-40">
              Add {picked.length} frames to the import list
            </button>
          </>
        ) : null}
        {busy ? (
          <p role="status" className="text-muted-foreground">
            {busy}
          </p>
        ) : null}
      </div>
    </details>
  )
}
