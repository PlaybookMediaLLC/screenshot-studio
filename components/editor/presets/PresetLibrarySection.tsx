'use client'

import * as React from 'react'
import { MoreHorizontalIcon, PlusSignIcon } from 'hugeicons-react'
import { toast } from 'sonner'
import { ProjectNameDialog } from '@/components/projects/ProjectNameDialog'
import { ProjectPreview } from '@/components/projects/ProjectPreview'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useHydratedSession } from '@/lib/auth/client'
import type { DesignDocument } from '@/lib/design/document'
import { useEditorDocument } from '@/lib/design/use-editor-document'
import {
  applyPreset,
  deletePreset,
  duplicatePreset,
  loadPresets,
  renamePreset,
  savePresetFromEditor,
  updatePresetFromEditor,
  usePresetLibrary,
} from '@/lib/presets/library'
import { applyPresetTo, type DesignPreset } from '@/lib/presets/preset'
import { useImageStore } from '@/lib/store'
import { useTRPCClient } from '@/lib/trpc/react'
import { SectionWrapper } from '../sections/SectionWrapper'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'That did not work. Try again.'
}

/**
 * The workspace's saved presets: save the design as one, and apply, preview,
 * rename, duplicate, update, or delete them. Previews show each preset on
 * the current screenshot.
 */
export function PresetLibrarySection() {
  const { data: session, isPending } = useHydratedSession()
  const trpcClient = useTRPCClient()
  const { error, loading, presets } = usePresetLibrary()
  const document = useEditorDocument()
  const canvas = useImageStore((state) => state.canvasDimensions)
  const [saving, setSaving] = React.useState(false)
  const [renaming, setRenaming] = React.useState<DesignPreset | null>(null)
  const [deleting, setDeleting] = React.useState<DesignPreset | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (session) void loadPresets(trpcClient).catch(() => undefined)
  }, [session, trpcClient])

  if (isPending) return null

  async function run(id: string, action: () => Promise<unknown>, success: string) {
    setBusy(id)
    try {
      await action()
      toast.success(success)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setBusy(null)
    }
  }

  const aspect = canvas ? `${canvas.canvasW} / ${canvas.canvasH}` : '4 / 3'

  return (
    <SectionWrapper
      action={
        session ? (
          <button
            aria-label="Save design as preset"
            className="flex h-6 items-center gap-1 rounded-md bg-muted/60 px-2 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setSaving(true)}
            type="button"
          >
            <PlusSignIcon size={10} />
            Save
          </button>
        ) : null
      }
      title="My presets"
    >
      {!session ? (
        <p className="px-2 text-[11px] text-muted-foreground">
          Sign in to save designs as presets for your workspace.
        </p>
      ) : error ? (
        <p className="px-2 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : presets.length === 0 ? (
        <p className="px-2 text-[11px] text-muted-foreground">
          {loading
            ? 'Loading presets…'
            : 'Save this design as a preset to reuse its layout, frame, background, text, and motion on other screenshots.'}
        </p>
      ) : (
        <ul aria-label="Saved presets" className="grid grid-cols-2 gap-1.5">
          {presets.map((preset) => (
            <li className="group relative" key={preset.id}>
              <button
                aria-label={`Apply preset ${preset.name}`}
                className="w-full overflow-hidden rounded-md border border-foreground/10 text-left transition-colors hover:border-foreground/25 disabled:opacity-60"
                disabled={busy === preset.id}
                onClick={() =>
                  run(preset.id, () => applyPreset(trpcClient, preset), `Applied “${preset.name}”`)
                }
                title={`Apply “${preset.name}” to this screenshot`}
                type="button"
              >
                <div style={{ aspectRatio: aspect }}>
                  <PresetPreview document={document} preset={preset} />
                </div>
                <p className="truncate px-1.5 py-1 pr-6 text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                  {preset.name}
                </p>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${preset.name} options`}
                  className="absolute bottom-0.5 right-0.5 grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <MoreHorizontalIcon size={12} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(preset)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      run(
                        preset.id,
                        () => duplicatePreset(trpcClient, preset),
                        `Duplicated “${preset.name}”`
                      )
                    }
                  >
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      run(
                        preset.id,
                        () => updatePresetFromEditor(trpcClient, preset),
                        `Updated “${preset.name}” from this design`
                      )
                    }
                  >
                    Update from this design
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => setDeleting(preset)}
                  >
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <ProjectNameDialog
        description="A preset keeps this design's layout, frame, background, text, elements, and motion. Your screenshot is not part of it."
        label="Preset name"
        maxLength={100}
        onOpenChange={setSaving}
        onSubmit={async (name) => {
          await savePresetFromEditor(trpcClient, name)
          toast.success(`Saved preset “${name}”`)
        }}
        open={saving}
        submitLabel="Save preset"
        title="Save as preset"
      />
      <ProjectNameDialog
        initialName={renaming?.name ?? ''}
        label="Preset name"
        maxLength={100}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSubmit={async (name) => {
          if (renaming) await renamePreset(trpcClient, renaming, name)
        }}
        open={renaming !== null}
        submitLabel="Rename"
        title="Rename preset"
      />
      <AlertDialog onOpenChange={(open) => !open && setDeleting(null)} open={deleting !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The preset leaves your workspace&apos;s library. Designs already made with it do not
              change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const preset = deleting
                if (preset)
                  void run(
                    preset.id,
                    () => deletePreset(trpcClient, preset),
                    `Deleted “${preset.name}”`
                  )
              }}
            >
              Delete preset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionWrapper>
  )
}

/** A preset drawn on the current screenshot (or on its own when the canvas is empty). */
function PresetPreview({
  document,
  preset,
}: {
  document: DesignDocument | null
  preset: DesignPreset
}) {
  const applied = React.useMemo(
    () => (document ? applyPresetTo(preset.document, document) : preset.document),
    [document, preset.document]
  )
  return <ProjectPreview alt={`${preset.name} preset`} document={applied} />
}
