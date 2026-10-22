'use client'

import { useWriteRouter } from '@/components/write/write-context'

import * as React from 'react'
import { createWritingDraft } from './pending-draft'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@shots/platejs-editor/ui'
import { useKeys } from './shortcuts'
import { draftHref, rememberSet, useWrite } from './write-context'

/**
 * Search and commands (⌘K): the set's drafts by text, its tags, switching
 * sets, and navigation. Choosing an item closes the palette and returns
 * focus to what opened it.
 */
export default function CommandPalette({
  onClose,
  onShortcuts,
}: {
  onClose: () => void
  onShortcuts: () => void
}) {
  const keys = useKeys()
  const router = useWriteRouter()
  const { beforeLeaveRef, canEdit, data, setQuery } = useWrite()
  const [results, setResults] = React.useState<{ id: string; title: string; plainText: string }[]>(
    []
  )
  const [search, setSearch] = React.useState('')
  React.useEffect(() => {
    if (!search.trim()) return setResults([])
    const controller = new AbortController()
    const query = new URLSearchParams({ limit: '20', search: search.trim() })
    if (data.activeSet) query.set('socialSetId', data.activeSet.id)
    const timer = setTimeout(() => {
      void fetch(`/api/v1/content-drafts?${query}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { items: [], pinned: [] }))
        .then((body: { items: typeof results; pinned: typeof results }) =>
          setResults([...body.pinned, ...body.items])
        )
        .catch(() => undefined)
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [data.activeSet, search])
  const go = (run: () => void) => {
    onClose()
    run()
  }
  return (
    <CommandDialog onOpenChange={(open) => !open && onClose()} open>
      <CommandInput
        onValueChange={setSearch}
        placeholder="Search drafts, tags, sets and commands"
        value={search}
      />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {results.length > 0 ? (
          <CommandGroup heading="Drafts">
            {results.map((draft) => (
              <CommandItem
                key={draft.id}
                onSelect={() => go(() => router.push(draftHref(draft.id, data.activeSet?.id)))}
                value={`draft ${draft.id} ${draft.title} ${draft.plainText}`}
              >
                <span className="truncate">{draft.title}</span>
                <span className="ml-2 truncate text-xs text-neutral-400">
                  {draft.plainText.slice(0, 60)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Commands">
          {canEdit ? (
            <CommandItem
              onSelect={() =>
                go(
                  () =>
                    void createWritingDraft({ socialSetId: data.activeSet?.id }, (id) => router.push(draftHref(id, data.activeSet?.id)), beforeLeaveRef.current ?? undefined)
                )
              }
            >
              New draft
              <CommandShortcut>{keys.label({ key: '.', mod: true })}</CommandShortcut>
            </CommandItem>
          ) : null}
          <CommandItem onSelect={() => go(() => router.push('/write'))}>
            Go to Write
            <CommandShortcut>{keys.label({ key: '1', mod: true, shift: true })}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => router.push('/write/plan'))}>
            Go to Calendar
            <CommandShortcut>{keys.label({ key: '2', mod: true, shift: true })}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => setQuery({ tab: 'queue' }))}>
            Show the queue
          </CommandItem>
          <CommandItem onSelect={() => go(onShortcuts)}>
            Keyboard shortcuts
            <CommandShortcut>{keys.label({ key: '/', mod: true, shift: true })}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        {data.experiments.tags && data.tags.length > 0 ? (
          <CommandGroup heading="Filter by tag">
            {data.tags.map((tag) => (
              <CommandItem
                key={tag.id}
                onSelect={() => go(() => setQuery({ tag: tag.id }))}
                value={`tag ${tag.name}`}
              >
                #{tag.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Brands">
          {data.sets.map((set) => (
            <CommandItem
              key={set.id}
              onSelect={() =>
                go(() => {
                  rememberSet(set.id)
                  setQuery({ set: set.id, tag: undefined })
                })
              }
              value={`set ${set.id} ${set.name}`}
            >
              {set.name}
              <span className="ml-2 text-xs text-neutral-400">
                {set.accounts
                  .map((connection) => connection.handle ?? connection.platform)
                  .join(' · ')}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
