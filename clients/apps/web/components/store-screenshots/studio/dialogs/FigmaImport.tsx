'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { parseFigmaFileUrl } from '@/lib/integrations/figma-url'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'

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
    <Accordion
      type="single"
      collapsible
      value={open ? 'details' : ''}
      onValueChange={(value) => setOpen(value === 'details')}
    >
      <AccordionItem value="details" className="rounded-lg border border-foreground/10 p-3 text-xs">
        <AccordionTrigger className="cursor-pointer font-medium">
          Import frames from Figma
        </AccordionTrigger>
        <AccordionContent className="p-0">
          <div className="mt-3 space-y-2">
            <Label className="block space-y-1">
              <span className="text-muted-foreground">Figma file link</span>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.figma.com/design/…"
                className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 outline-none"
              />
            </Label>
            <Label className="block space-y-1">
              <span className="text-muted-foreground">
                Personal access token (read-only file access is enough)
              </span>
              <Input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 outline-none"
              />
            </Label>
            <p className="text-[10px] text-muted-foreground">
              The token is used for this import only and is not saved.
            </p>
            <Button
              variant="custom"
              size={null}
              type="button"
              disabled={!parsed || token.length < 10 || Boolean(busy)}
              onClick={() => void listFrames()}
              className="h-8 rounded-md border border-foreground/15 px-2.5 disabled:opacity-40"
            >
              List frames
            </Button>
            {frames.length ? (
              <>
                <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Figma frames">
                  {frames.map((frame) => (
                    <li key={frame.id}>
                      <Label
                        className={cn(
                          'flex items-center gap-2 rounded px-1.5 py-1',
                          picked.includes(frame.id) && 'bg-foreground/[0.05]'
                        )}
                      >
                        <Checkbox
                          checked={picked.includes(frame.id)}
                          onCheckedChange={(checked) =>
                            setPicked(
                              checked === true
                                ? [...picked, frame.id]
                                : picked.filter((id) => id !== frame.id)
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {frame.page} · {Math.round(frame.width)} × {Math.round(frame.height)}
                        </span>
                      </Label>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="custom"
                  size={null}
                  type="button"
                  disabled={picked.length === 0 || Boolean(busy)}
                  onClick={() => void importFrames()}
                  className="h-8 rounded-md bg-foreground px-2.5 text-background disabled:opacity-40"
                >
                  Add {picked.length} frames to the import list
                </Button>
              </>
            ) : null}
            {busy ? (
              <p role="status" className="text-muted-foreground">
                {busy}
              </p>
            ) : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
