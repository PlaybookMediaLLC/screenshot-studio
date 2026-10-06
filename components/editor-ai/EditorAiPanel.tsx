'use client'

import { AiMagicIcon, ArrowUp02Icon, Cancel01Icon } from 'hugeicons-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { applyDesignChanges } from '@/lib/design/apply'
import type { DesignChanges } from '@/lib/design/document'
import { describeSelection, exportDesignDocument } from '@/lib/design/export'
import { captureCanvasSnapshot } from '@/lib/design/snapshot'
import { openDesignInEditor } from '@/lib/design/open-design'
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts'
import { useImageStore } from '@/lib/store'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
import { saveExportToWorkspace } from '@/lib/workspace/save-export'
import { useEditorCopilot } from './useEditorCopilot'

/**
 * The editor's AI surface: one floating panel with
 *
 * - Copilot: a conversation that edits the live canvas, scoped to the
 *   selected layer when there is one (⌘K opens it on the selection);
 * - Suggestions: up to three one-click improvements from a design review;
 * - Directions: rendered variations of the current design to choose from.
 *
 * Every AI change goes through the editor's own store actions and is one
 * undo step, so ⌘Z always takes it back.
 */

type Status = { copilot: boolean; directions: boolean }
type Suggestion = { changes: DesignChanges; reason: string; title: string }
type Direction = {
  designId: string
  name: string
  previewUrl: string | null
  rationale: string
}

const QUICK_PROMPTS = [
  'Make it pop on a dark gradient',
  'Add a short headline above the screenshot',
  'Put it in a laptop mockup',
  'Point an arrow at the main button',
  'Blur any personal details',
  'Make a 9:16 version for stories',
]

/** The workspace copy of the current main image, uploaded once per image. */
const uploadedSources = new Map<string, string>()

export function EditorAiPanel() {
  const trpcClient = useTRPCClient()
  const [status, setStatus] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'copilot' | 'directions'>('copilot')
  const [input, setInput] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [reviewing, setReviewing] = useState(false)
  // At most one automatic review per opening, whatever its outcome.
  const autoReviewed = useRef(false)
  const [directionPrompt, setDirectionPrompt] = useState('')
  const [directions, setDirections] = useState<Direction[]>([])
  const [exploring, setExploring] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const { entries, isRunning, reset, send } = useEditorCopilot()
  const hasImage = useImageStore(
    (state) => Boolean(state.uploadedImageUrl) || state.mockups.length > 0
  )

  // Signed-out visitors and unconfigured environments get no AI surface.
  useEffect(() => {
    trpcClient.editorAi.status
      .query()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [trpcClient])

  const openCopilot = useCallback((scoped: boolean) => {
    setSelection(scoped ? (describeSelection()?.label ?? null) : null)
    setTab('copilot')
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // ⌘K / Ctrl+K: ask the copilot about the selected layer.
  useEffect(() => {
    if (!status?.copilot) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreEditorShortcut(event) || !(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      openCopilot(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openCopilot, status?.copilot])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [entries])

  const review = useCallback(async () => {
    setReviewing(true)
    try {
      const { suggestions: found } = await trpcClient.editorAi.critique.mutate({
        document: exportDesignDocument(),
        snapshot: await captureCanvasSnapshot(768),
      })
      setSuggestions(found)
    } catch (error) {
      toast.error('Could not review the design', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setReviewing(false)
    }
  }, [trpcClient])

  // Review once each time the panel opens on a design, never while editing.
  useEffect(() => {
    if (!open) {
      autoReviewed.current = false
      return
    }
    if (autoReviewed.current || !hasImage || !status?.copilot) return
    autoReviewed.current = true
    void review()
  }, [hasImage, open, review, status?.copilot])

  async function applySuggestion(suggestion: Suggestion) {
    await applyDesignChanges(suggestion.changes, (ref) => ref)
    setSuggestions((current) => current?.filter((item) => item !== suggestion) ?? null)
    toast.success(suggestion.title, { description: 'Applied. Press ⌘Z to undo.' })
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    await send(text, selection)
  }

  async function workspaceImageRef(): Promise<string> {
    const url = useImageStore.getState().uploadedImageUrl
    if (!url) throw new Error('Add an image to the canvas first.')
    const cached = uploadedSources.get(url)
    if (cached) return cached
    const blob = await (await fetch(url)).blob()
    const { assetId } = await saveExportToWorkspace({ blob, fileName: 'source.png', trpcClient })
    const ref = `asset:${assetId}`
    uploadedSources.set(url, ref)
    return ref
  }

  async function explore() {
    setExploring(true)
    try {
      const document = exportDesignDocument()
      const src = await workspaceImageRef()
      const result = await trpcClient.editorAi.explore.mutate({
        count: 4,
        direction: directionPrompt.trim() || undefined,
        document: { ...document, image: { ...document.image, src } },
      })
      setDirections(result.directions)
      if (result.directions.length === 0) toast.error('No directions came back. Try again.')
    } catch (error) {
      toast.error('Could not explore directions', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setExploring(false)
    }
  }

  async function chooseDirection(direction: Direction) {
    try {
      await openDesignInEditor(trpcClient, direction.designId, 'step')
      toast.success(`Applied “${direction.name}”`, { description: 'Press ⌘Z to go back.' })
    } catch {
      toast.error('Could not open that direction.')
    }
  }

  if (!status?.copilot) return null

  return (
    <>
      <Button
        aria-expanded={open}
        aria-label="Open the AI copilot"
        className="fixed bottom-4 right-4 z-40 gap-1.5 rounded-full shadow-lg"
        onClick={() => (open ? setOpen(false) : openCopilot(false))}
        size="sm"
        type="button"
      >
        <AiMagicIcon size={16} />
        AI
        <kbd className="ml-1 hidden rounded bg-background/20 px-1 text-[10px] lg:inline">⌘K</kbd>
      </Button>

      {open ? (
        <section
          aria-label="AI copilot"
          className="fixed bottom-16 right-3 top-[72px] z-40 flex w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
          data-export-exclude
        >
          <header className="flex items-center gap-1 border-b p-2">
            {(['copilot', 'directions'] as const).map((value) => (
              <button
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm font-medium',
                  tab === value ? 'bg-muted text-foreground' : 'text-muted-foreground'
                )}
                key={value}
                onClick={() => setTab(value)}
                type="button"
              >
                {value === 'copilot' ? 'Copilot' : 'Directions'}
              </button>
            ))}
            <span className="flex-1" />
            {tab === 'copilot' && entries.length > 0 ? (
              <Button onClick={reset} size="sm" type="button" variant="ghost">
                New chat
              </Button>
            ) : null}
            <Button
              aria-label="Close"
              onClick={() => setOpen(false)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Cancel01Icon size={16} />
            </Button>
          </header>

          {tab === 'copilot' ? (
            <>
              <div className="border-b p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
                  <button
                    className="text-xs underline disabled:opacity-50"
                    disabled={reviewing || !hasImage}
                    onClick={() => void review()}
                    type="button"
                  >
                    {reviewing ? 'Reviewing…' : 'Review again'}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestions?.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Looks good. Nothing to fix.</p>
                  ) : null}
                  {suggestions?.map((suggestion) => (
                    <button
                      className="rounded-full border px-2.5 py-1 text-left text-xs hover:bg-muted"
                      key={suggestion.title}
                      onClick={() => void applySuggestion(suggestion)}
                      title={suggestion.reason}
                      type="button"
                    >
                      {suggestion.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" ref={transcriptRef}>
                {entries.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      Tell me what to change. I edit the canvas directly, and every change is one
                      ⌘Z.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_PROMPTS.map((prompt) => (
                        <button
                          className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                          disabled={isRunning}
                          key={prompt}
                          onClick={() => void send(prompt, selection)}
                          type="button"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {entries.map((entry, index) =>
                  entry.kind === 'change' ? (
                    <p className="text-xs text-muted-foreground" key={index}>
                      ✓ {entry.summary}
                    </p>
                  ) : (
                    <p
                      className={cn(
                        'whitespace-pre-wrap rounded-lg px-3 py-2',
                        entry.kind === 'user' && 'ml-8 bg-muted',
                        entry.kind === 'assistant' && 'mr-8 border',
                        entry.kind === 'error' && 'border border-destructive text-destructive'
                      )}
                      key={index}
                    >
                      {entry.text}
                    </p>
                  )
                )}
                {isRunning ? <p className="text-xs text-muted-foreground">Working on it…</p> : null}
              </div>

              <form className="border-t p-2" onSubmit={handleSend}>
                {selection ? (
                  <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                    Editing {selection}
                    <button className="underline" onClick={() => setSelection(null)} type="button">
                      whole design
                    </button>
                  </p>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    aria-label="Ask the copilot"
                    className="max-h-32 min-h-10 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm"
                    disabled={isRunning}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void handleSend()
                      }
                    }}
                    placeholder="Make the background darker and tilt it slightly"
                    ref={inputRef}
                    rows={1}
                    value={input}
                  />
                  <Button
                    aria-label="Send"
                    disabled={isRunning || !input.trim()}
                    size="icon"
                    type="submit"
                  >
                    <ArrowUp02Icon size={16} />
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
              <p className="text-muted-foreground">
                Render different takes on this design and pick one. Your current design stays one ⌘Z
                away.
              </p>
              <textarea
                aria-label="What to explore"
                className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm"
                onChange={(event) => setDirectionPrompt(event.target.value)}
                placeholder="Optional: e.g. warmer, more playful, for LinkedIn"
                rows={2}
                value={directionPrompt}
              />
              <Button
                className="w-full"
                disabled={!status.directions || exploring || !hasImage}
                onClick={() => void explore()}
                type="button"
              >
                {exploring ? 'Rendering directions…' : 'Explore 4 directions'}
              </Button>
              {!status.directions ? (
                <p className="text-xs text-muted-foreground">
                  Rendering variations is not enabled in this environment.
                </p>
              ) : null}
              <ul className="grid grid-cols-2 gap-2">
                {directions.map((direction) => (
                  <li key={direction.designId}>
                    <button
                      className="w-full overflow-hidden rounded-lg border text-left hover:ring-2 hover:ring-ring"
                      onClick={() => void chooseDirection(direction)}
                      title={direction.rationale}
                      type="button"
                    >
                      {direction.previewUrl ? (
                        // Signed, short-lived tenant URL; next/image would cache it past expiry.
                        <img
                          alt={direction.name}
                          className="w-full bg-muted"
                          src={direction.previewUrl}
                        />
                      ) : null}
                      <span className="block px-2 py-1.5 text-xs font-medium">
                        {direction.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : null}
    </>
  )
}
