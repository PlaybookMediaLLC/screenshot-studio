'use client'

import { useEffect, useState } from 'react'
import { StoreIcon as DeviceMobileIcon } from '@/components/platform-shell/icons'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { CreateScene } from '@/components/platform-ui/empty-scenes'
import { EmptyState } from '@/components/platform-ui'
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
        <ul className="studio-grid">
          {shown.map((item) => (
            <li className="studio-shot" key={item.id}>
              <SidebarLink
                href={`/?editor=app-store&storeProject=${encodeURIComponent(item.id)}`}
                className="block"
              >
                <span className="studio-shot-media">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="size-full object-contain" />
                  ) : (
                    <span className="grid size-full place-items-center text-sm text-muted-foreground">
                      {item.slideCount} slides
                    </span>
                  )}
                  <span aria-hidden="true" className="studio-shot-overlay">
                    {item.name}
                  </span>
                </span>
                <span className="studio-shot-meta">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Store screenshots · On this browser ·{' '}
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </span>
              </SidebarLink>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          scene={query ? undefined : <CreateScene />}
          icon={DeviceMobileIcon}
          title={query ? 'No matching store projects' : 'No store projects on this browser'}
          description={
            query
              ? 'No local projects match this search.'
              : 'Store screenshot projects are saved on the browser that made them. Build one to see it here.'
          }
          action={<ButtonLink href="/?editor=app-store">Build store screenshots</ButtonLink>}
        />
      )}
    </section>
  )
}
