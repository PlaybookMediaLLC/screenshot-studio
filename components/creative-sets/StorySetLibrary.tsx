'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search01Icon } from 'hugeicons-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { creativeSetSortSchema } from '@/lib/creative-sets/schema'
import { StorySetAccess } from './StorySetAccess'
import { StorySetFormatPreview } from './StorySetFormatPreview'
import { useTRPCClient } from '@/lib/trpc/react'
import { StorySetIntake } from './StorySetIntake'
import { usePrivateCreativeSurface } from './use-private-surface'
import { ImportProject } from './ImportProject'

type Item = Awaited<
  ReturnType<ReturnType<typeof useTRPCClient>['creativeSet']['list']['query']>
>['items'][number]

export function StorySetLibrary({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  usePrivateCreativeSurface()
  const client = useTRPCClient()
  const [ready, setReady] = useState(false),
    [importing, setImporting] = useState(false)
  const [items, setItems] = useState<Item[]>([]),
    [cursor, setCursor] = useState<string | null>(null)
  const params = useSearchParams()
  const search = (params.get('search') ?? '').slice(0, 200)
  const query = search.trim()
  const sort = creativeSetSortSchema.catch('updated').parse(params.get('sort') ?? 'updated')
  const [creating, setCreating] = useState(false),
    [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null),
    [actionError, setActionError] = useState<string | null>(null),
    [busy, setBusy] = useState(true)
  const request = useRef(0)
  const load = useCallback(
    async (next: string | null) => {
      const current = ++request.current
      setBusy(true)
      setError(null)
      try {
        const result = await client.creativeSet.list.query({
          cursor: next ?? undefined,
          search: query || undefined,
          sort,
        })
        if (current !== request.current) return
        setItems((items) => (next ? [...items, ...result.items] : result.items))
        setCursor(result.nextCursor)
      } catch {
        if (current === request.current)
          setError('We couldn’t load your Story Sets. Please try again.')
      } finally {
        if (current === request.current) setBusy(false)
      }
    },
    [client, query, sort]
  )
  useEffect(() => {
    setReady(true)
    setBusy(true)
    setError(null)
    setItems([])
    setCursor(null)
    const timer = setTimeout(() => void load(null), 200)
    return () => {
      // Invalidate in-flight requests; this counter is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++request.current
      clearTimeout(timer)
    }
  }, [load, refresh])
  function updateFilter(name: 'search' | 'sort', value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(name, value)
    else url.searchParams.delete(name)
    window.history.replaceState(null, '', url)
  }
  if (creating) return <StorySetIntake onCancel={() => setCreating(false)} />
  return (
    <main className="w-full space-y-8 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-emerald-400">
            Product evidence, connected
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Story Sets</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Product benefits, editable formats and connected evidence. Keep your launch creative
            current as your product changes.
          </p>
        </div>
        {canCreate && canEdit ? (
          <div className="flex gap-2">
            <Button variant="outline" disabled={!ready} onClick={() => setImporting(true)}>
              Copy from Projects
            </Button>
            <Button disabled={!ready} onClick={() => setCreating(true)}>
              New Story Set
            </Button>
          </div>
        ) : null}
      </header>
      {!canCreate ? <StorySetAccess /> : null}
      {canCreate && !canEdit ? (
        <p className="text-sm text-muted-foreground">
          You have view-only access. Ask a workspace owner or admin for permission to create and
          edit Story Sets.
        </p>
      ) : null}
      {busy || error || items.length > 0 || query ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search01Icon
            aria-hidden
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search Story Sets"
            placeholder="Search Story Sets"
            maxLength={200}
            value={search}
            onChange={(event) => updateFilter('search', event.target.value.slice(0, 200))}
            className="pl-9"
          />
        </div>
        <Label className="flex items-center gap-2">
          Sort
          <Select value={sort} onValueChange={(value) => updateFilter('sort', value)}>
            <SelectTrigger aria-label="Sort Story Sets">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Last edited</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </Label>
      </div> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button variant="outline" onClick={() => void load(cursor)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading Story Sets…
        </p>
      ) : null}
      {!busy && !error && !items.length ? (
        <section className="space-y-3 rounded-xl border p-8 text-center">
          <h2 className="font-medium">{query ? 'No matching Story Sets' : 'No Story Sets yet'}</h2>
          <p className="break-words text-sm text-muted-foreground">
            {query
              ? `No Story Sets match “${query}”.`
              : canCreate && canEdit
                ? 'Start with a screenshot and the benefit it proves.'
                : 'Your saved Story Sets will appear here.'}
          </p>
          {query ? (
            <Button variant="outline" onClick={() => updateFilter('search', '')}>
              Clear search
            </Button>
          ) : null}
        </section>
      ) : null}
      <div aria-busy={busy} className="grid gap-6 lg:grid-cols-2">
        {items.map((item) => (
          <article
            className="min-w-0 overflow-hidden rounded-xl border bg-foreground/[0.02]"
            key={item.id}
          >
            <Link
              prefetch={false}
              href={`/creative-sets/${item.id}`}
              aria-label={item.name}
              className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="mx-auto max-w-2xl p-3 pb-0 sm:p-4 sm:pb-0">
                <StorySetFormatPreview
                  setId={item.id}
                  revision={item.revision}
                  document={item.document}
                />
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="min-w-0 break-words font-medium">{item.name}</h2>
                  {item.document &&
                  [...item.document.outputs, ...item.document.storeGroups].some((output) =>
                    Object.values(output.review).some(Boolean)
                  ) ? (
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                      Needs review
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.document?.stories.length ?? '—'}{' '}
                  {item.document?.stories.length === 1 ? 'story' : 'stories'} ·{' '}
                  {item.document?.outputs.length ?? '—'} formats · Revision {item.revision}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Last edited{' '}
                  <time dateTime={item.updatedAt.toISOString()}>
                    {item.updatedAt.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </time>
                </p>
              </div>
            </Link>
            {canEdit ? (
              <div className="flex gap-2 px-4 pb-4">
                {canCreate ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setActionError(null)
                      void client.creativeSet.duplicate
                        .mutate({ creativeSetId: item.id })
                        .then(() => setRefresh((value) => value + 1))
                        .catch(() =>
                          setActionError('Could not update this Story Set. Please try again.')
                        )
                    }}
                  >
                    Duplicate
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActionError(null)
                    void client.creativeSet.archive
                      .mutate({ creativeSetId: item.id })
                      .then(() => setRefresh((value) => value + 1))
                      .catch(() =>
                        setActionError('Could not update this Story Set. Please try again.')
                      )
                  }}
                >
                  Archive
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {cursor && !error ? (
        <Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>
          Load more
        </Button>
      ) : null}
      {importing ? <ImportProject onClose={() => setImporting(false)} /> : null}
    </main>
  )
}
