'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProjectPreview } from '@/components/projects/ProjectPreview'
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
  const [search, setSearch] = useState(''),
    [creating, setCreating] = useState(false),
    [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    setReady(true)
    let active = true
    const timer = setTimeout(() => {
      setBusy(true)
      client.creativeSet.list
        .query({ search })
        .then(
          (result) => {
            if (active) {
              setItems(result.items)
              setCursor(result.nextCursor)
              setError(null)
            }
          },
          (error) => {
            if (active) setError(error.message)
          }
        )
        .finally(() => {
          if (active) setBusy(false)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [client, search, refresh])
  if (creating) return <StorySetIntake onCancel={() => setCreating(false)} />
  return (
    <main className="mx-auto max-w-7xl space-y-8 p-8">
      <header className="flex items-start justify-between gap-4">
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
      {!canCreate ? (
        <p className="text-sm text-muted-foreground">
          New Story Sets are available to design partners. Saved sets remain available here.
        </p>
      ) : null}
      <Input
        type="search"
        aria-label="Search Story Sets"
        placeholder="Search Story Sets"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />
      {error ? <p role="alert">{error}</p> : null}
      {!busy && !items.length ? (
        <p className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          Start with a screenshot and the benefit it proves.
        </p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article className="overflow-hidden rounded-xl border bg-foreground/[0.02]" key={item.id}>
            <Link href={`/creative-sets/${item.id}`} className="block">
              <div className="aspect-video">
                <ProjectPreview
                  alt={item.name}
                  document={item.document?.outputs[0]?.document ?? null}
                />
              </div>
              <div className="p-4">
                <h2 className="font-medium">{item.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.document?.stories.length ?? '—'} stories ·{' '}
                  {item.document?.outputs.length ?? '—'} formats · Revision {item.revision}
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
                      void client.creativeSet.duplicate
                        .mutate({ creativeSetId: item.id })
                        .then(() => setRefresh((value) => value + 1))
                        .catch((error) => setError(error.message))
                    }}
                  >
                    Duplicate
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void client.creativeSet.archive
                      .mutate({ creativeSetId: item.id })
                      .then(() => setRefresh((value) => value + 1))
                      .catch((error) => setError(error.message))
                  }}
                >
                  Archive
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {cursor ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const result = await client.creativeSet.list.query({ cursor, search })
              setItems((items) => [...items, ...result.items])
              setCursor(result.nextCursor)
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Loading failed.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Load more
        </Button>
      ) : null}
      {importing ? <ImportProject onClose={() => setImporting(false)} /> : null}
    </main>
  )
}
