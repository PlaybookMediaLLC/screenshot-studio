'use client'

import { useEffect, useState } from 'react'
import { listProjects, type ProjectSummary } from '@/lib/store-screenshots/persistence/projects'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Discover local work without copying it to the workspace or changing IndexedDB. */
export function LocalStoreProjects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let active = true
    setError(null)
    void listProjects().then(
      (items) => {
        if (active) setProjects(items)
      },
      (failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Local projects could not load.')
      }
    )
    return () => {
      active = false
    }
  }, [attempt])
  const shown = projects?.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <section className="space-y-4" aria-label="Store screenshot projects">
      <p className="text-sm text-muted-foreground">
        On this browser only. These projects belong to this browser profile and are not synchronized
        to your workspace.
      </p>
      <Input
        aria-label="Search store projects"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search store projects"
      />
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Retry local projects
          </Button>
        </div>
      ) : projects === null ? (
        <p role="status">Loading local projects…</p>
      ) : shown?.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => (
            <li key={item.id}>
              <SidebarLink
                href={`/?editor=app-store&storeProject=${encodeURIComponent(item.id)}`}
                className="flex h-full flex-col gap-3 rounded-xl border p-4"
              >
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" className="aspect-[4/3] w-full object-contain" />
                ) : (
                  <div className="grid aspect-[4/3] place-items-center bg-muted text-sm">
                    {item.slideCount} slides
                  </div>
                )}
                <span className="font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  Store screenshots · On this browser ·{' '}
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </SidebarLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {query
            ? 'No local projects match this search.'
            : 'No store projects saved on this browser yet.'}{' '}
          <SidebarLink className="underline" href="/?editor=app-store">
            Build store screenshots
          </SidebarLink>
        </p>
      )}
    </section>
  )
}
