'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { draftsApi } from '@/lib/content-drafts/client'
import { cn } from '@/lib/utils'
import { WriteRail } from './library'
import { type Shortcut, useKeys, useShortcuts } from './shortcuts'
import { draftHref, useWrite, type WriteLibrary, WriteProvider } from './write-context'

// The palette loads on first use: it is not part of reading a draft.
const CommandPalette = dynamic(() => import('./CommandPalette'), { ssr: false })

/** The shortcuts the reference lists, with where each applies. */
export const SHORTCUT_REFERENCE: {
  group: string
  items: (Pick<Shortcut, 'alt' | 'key' | 'mod' | 'shift'> & { label: string })[]
}[] = [
  {
    group: 'Everywhere in Write',
    items: [
      { key: 'k', label: 'Search and commands', mod: true },
      { key: '/', label: 'Show or hide the drafts list', mod: true },
      { key: '1', label: 'Write', mod: true, shift: true },
      { key: '2', label: 'Calendar', mod: true, shift: true },
      { key: '.', label: 'New draft', mod: true },
      { alt: true, key: 'arrowdown', label: 'Next draft', mod: true },
      { alt: true, key: 'arrowup', label: 'Previous draft', mod: true },
      { key: '/', label: 'This list of shortcuts', mod: true, shift: true },
    ],
  },
  {
    group: 'In a draft',
    items: [
      { key: '\\', label: 'Draft details', mod: true },
      { key: 'p', label: 'Pin or unpin', mod: true, shift: true },
      { alt: true, key: 's', label: 'Share', mod: true },
      {
        key: 'enter',
        label: 'Open the publish review (never publishes by itself)',
        mod: true,
        shift: true,
      },
      {
        alt: true,
        key: 'enter',
        label: 'Schedule at the next free slot (opens the review)',
        mod: true,
      },
      { key: 'enter', label: 'Add a post', mod: true },
      { alt: true, key: 'arrowup', label: 'Move the post up' },
      { alt: true, key: 'arrowdown', label: 'Move the post down' },
      { key: 'i', label: 'Add media', mod: true, shift: true },
      { key: '.', label: 'Emoji', mod: true, shift: true },
      { key: 'f', label: 'Focus mode', mod: true, shift: true },
      { key: 'h', label: 'Display mode: compact or comfortable', mod: true, shift: true },
      { key: 'm', label: 'Comment on the selection', mod: true, shift: true },
      { key: 'j', label: 'Writing assistant', mod: true },
      { key: 'e', label: 'Rewrite with AI', mod: true, shift: true },
      { key: 'v', label: 'Preview', mod: true, shift: true },
    ],
  },
]

/**
 * The Write frame: the library on the left and the open draft, or a hint,
 * filling the rest. On a phone the library is the page until a draft opens,
 * then a drawer; the draft's identity and save state stay visible.
 */
export function WriteFrame({
  activeId,
  canEdit,
  canManageSets,
  canPublish,
  canReview,
  children,
  data,
}: {
  activeId?: string
  canEdit: boolean
  canManageSets: boolean
  canPublish: boolean
  canReview: boolean
  children: React.ReactNode
  data: WriteLibrary
}) {
  return (
    <WriteProvider
      activeId={activeId}
      canEdit={canEdit}
      canManageSets={canManageSets}
      canPublish={canPublish}
      canReview={canReview}
      data={data}
    >
      <FrameLayout activeId={activeId}>{children}</FrameLayout>
    </WriteProvider>
  )
}

/** Opens the drafts drawer on a phone, from anywhere in the frame. */
export const DraftsDrawerContext = React.createContext<() => void>(() => {})

function FrameLayout({ activeId, children }: { activeId?: string; children: React.ReactNode }) {
  const router = useRouter()
  const keys = useKeys()
  const { canEdit, data } = useWrite()
  const [railOpen, setRailOpen] = React.useState(true)
  const [drawer, setDrawer] = React.useState(false)
  const [palette, setPalette] = React.useState(false)
  const [reference, setReference] = React.useState(false)
  const launcher = React.useRef<HTMLElement | null>(null)
  const open = (setter: (value: boolean) => void) => {
    launcher.current = document.activeElement as HTMLElement | null
    setter(true)
  }
  const step = (delta: number) => {
    const ids = data.library.map((draft) => draft.id)
    const index = activeId ? ids.indexOf(activeId) : -1
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))]
    if (next && next !== activeId) router.push(draftHref(next, data.activeSet?.id))
  }
  useShortcuts([
    {
      key: 'k',
      label: 'Search and commands',
      mod: true,
      run: () => open(setPalette),
      inEditor: true,
    },
    {
      key: '/',
      label: 'Drafts list',
      mod: true,
      run: () => setRailOpen((current) => !current),
      inEditor: true,
    },
    {
      key: '!',
      label: 'Write',
      mod: true,
      run: () => router.push('/write'),
      shift: true,
      inEditor: true,
    },
    {
      key: '1',
      label: 'Write',
      mod: true,
      run: () => router.push('/write'),
      shift: true,
      inEditor: true,
    },
    {
      key: '@',
      label: 'Calendar',
      mod: true,
      run: () => router.push('/write/plan'),
      shift: true,
      inEditor: true,
    },
    {
      key: '2',
      label: 'Calendar',
      mod: true,
      run: () => router.push('/write/plan'),
      shift: true,
      inEditor: true,
    },
    {
      key: '.',
      label: 'New draft',
      mod: true,
      inEditor: true,
      run: () => {
        if (!canEdit) return
        void draftsApi
          .create({ socialSetId: data.activeSet?.id })
          .then((draft) => router.push(draftHref(draft.id, data.activeSet?.id)))
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : 'No new draft.')
          )
      },
    },
    {
      alt: true,
      key: 'arrowdown',
      label: 'Next draft',
      mod: true,
      run: () => step(1),
      inEditor: true,
    },
    {
      alt: true,
      key: 'arrowup',
      label: 'Previous draft',
      mod: true,
      run: () => step(-1),
      inEditor: true,
    },
    {
      key: '?',
      label: 'Shortcuts',
      mod: true,
      run: () => open(setReference),
      shift: true,
      inEditor: true,
    },
    {
      key: '/',
      label: 'Shortcuts',
      mod: true,
      run: () => open(setReference),
      shift: true,
      inEditor: true,
    },
  ])
  const restoreFocus = () => {
    // Focus goes back to whatever opened the dialog.
    setTimeout(() => launcher.current?.focus(), 0)
  }
  return (
    <DraftsDrawerContext.Provider value={() => setDrawer(true)}>
      <div
        className="flex h-[100dvh] min-h-0 md:h-[calc(100vh-1rem-2px)]"
        data-testid="write-frame"
      >
        <div
          className={cn(
            'w-full shrink-0 border-white/[0.06] md:w-80 md:border-r',
            activeId ? 'hidden' : 'block',
            railOpen ? 'md:block' : 'md:hidden'
          )}
        >
          <WriteRail key={data.activeSet?.id ?? 'none'} />
        </div>
        <main
          className={cn('relative min-w-0 flex-1 overflow-y-auto', !activeId && 'hidden md:block')}
        >
          {children}
        </main>
      </div>
      <Sheet onOpenChange={setDrawer} open={drawer}>
        <SheetContent className="w-full p-0 sm:max-w-sm" side="left">
          <SheetHeader className="sr-only">
            <SheetTitle>Drafts</SheetTitle>
            <SheetDescription>The drafts of this brand.</SheetDescription>
          </SheetHeader>
          <WriteRail key={data.activeSet?.id ?? 'none'} />
        </SheetContent>
      </Sheet>
      {palette ? (
        <CommandPalette
          onClose={() => {
            setPalette(false)
            restoreFocus()
          }}
          onShortcuts={() => setReference(true)}
        />
      ) : null}
      <Dialog
        onOpenChange={(value) => {
          setReference(value)
          if (!value) restoreFocus()
        }}
        open={reference}
      >
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Shortcuts wait while you type in a field or a dialog is open, except the ones meant
              for writing. Publishing shortcuts only open the review.
            </DialogDescription>
          </DialogHeader>
          {SHORTCUT_REFERENCE.map((group) => (
            <section key={group.group}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {group.group}
              </h3>
              <dl
                className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm"
                data-testid="shortcut-reference"
              >
                {group.items.map((item) => (
                  <React.Fragment key={`${group.group}-${item.label}`}>
                    <dt className="text-neutral-300">{item.label}</dt>
                    <dd>
                      <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs text-neutral-200">
                        {keys.label(item)}
                      </kbd>
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
        </DialogContent>
      </Dialog>
    </DraftsDrawerContext.Provider>
  )
}

/** The phone's way back to the drafts list from an open draft. */
export function DraftsDrawerButton() {
  const openDrawer = React.useContext(DraftsDrawerContext)
  return (
    <Button
      aria-label="Drafts"
      className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:text-white md:hidden"
      onClick={openDrawer}
      size={null}
      type="button"
      variant="custom"
    >
      ☰
    </Button>
  )
}
