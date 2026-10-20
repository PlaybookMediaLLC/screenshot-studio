'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Folder01Icon, MoreHorizontalIcon, Search01Icon } from 'hugeicons-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { DESIGN_DOCUMENT_VERSION, type DesignDocument } from '@/lib/design/document'
import { type ProjectSort, projectSortSchema } from '@/lib/projects/schema'
import { forgetProject } from '@/lib/projects/session'
import { useTRPCClient } from '@/lib/trpc/react'
import { ProjectNameDialog } from './ProjectNameDialog'
import { ProjectPreview } from './ProjectPreview'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

type LibraryProject = {
  document: DesignDocument | null
  id: string
  name: string
  updatedAt: Date
}

type Page = { error: string | null; items: LibraryProject[]; loading: boolean; next: string | null }

const PAGE_SIZE = 24
const SORT_LABELS: Record<ProjectSort, string> = { name: 'Name', updated: 'Last edited' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function editorHref(projectId: string): string {
  return `/?project=${encodeURIComponent(projectId)}`
}

/** The workspace's projects: search, open, rename, duplicate, delete, and start new ones. */
export function ProjectLibrary({ canEdit }: { canEdit: boolean }) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const [search, setSearch] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [sort, setSort] = React.useState<ProjectSort>('updated')
  const [page, setPage] = React.useState<Page>({
    error: null,
    items: [],
    loading: true,
    next: null,
  })
  const [creating, setCreating] = React.useState(false)
  const [renaming, setRenaming] = React.useState<LibraryProject | null>(null)
  const [deleting, setDeleting] = React.useState<LibraryProject | null>(null)
  const [deletePending, setDeletePending] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  // Only the newest request may write, so a slow earlier search cannot win.
  const requestRef = React.useRef(0)
  const load = React.useCallback(
    async (cursor: string | null) => {
      const request = ++requestRef.current
      setPage((current) => ({ ...current, error: null, loading: true }))
      try {
        const result = await trpcClient.project.list.query({
          cursor: cursor ?? undefined,
          limit: PAGE_SIZE,
          search: query || undefined,
          sort,
        })
        if (request !== requestRef.current) return
        setPage((current) => ({
          error: null,
          items: cursor ? [...current.items, ...result.items] : result.items,
          loading: false,
          next: result.nextCursor,
        }))
      } catch (error) {
        if (request !== requestRef.current) return
        setPage((current) => ({ ...current, error: errorMessage(error), loading: false }))
      }
    },
    [query, sort, trpcClient]
  )

  React.useEffect(() => {
    void load(null)
  }, [load])

  async function duplicate(project: LibraryProject) {
    try {
      const copy = await trpcClient.project.duplicate.mutate({ projectId: project.id })
      setPage((current) => ({ ...current, items: [copy, ...current.items] }))
      toast.success(`Duplicated as “${copy.name}”`)
    } catch (error) {
      toast.error('Could not duplicate the project', { description: errorMessage(error) })
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeletePending(true)
    try {
      await trpcClient.project.delete.mutate({ projectId: deleting.id })
      forgetProject(deleting.id)
      setPage((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== deleting.id),
      }))
      toast.success(`Deleted “${deleting.name}”`)
      setDeleting(null)
    } catch (error) {
      toast.error('Could not delete the project', { description: errorMessage(error) })
    } finally {
      setDeletePending(false)
    }
  }

  const empty = !page.loading && !page.error && page.items.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search01Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500"
            size={15}
          />
          <Input
            aria-label="Search projects"
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            type="search"
            value={search}
          />
        </div>
        <Label className="flex items-center gap-2 text-sm text-neutral-400">
          Sort
          <Select
            onValueChange={(nextValue) => setSort(projectSortSchema.parse(nextValue))}
            value={sort}
          >
            <SelectTrigger className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectSortSchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {SORT_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        {canEdit ? <Button onClick={() => setCreating(true)}>New project</Button> : null}
      </div>

      {page.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {page.error}{' '}
            <Button variant="custom" size={null} className="underline" onClick={() => void load(null)} type="button">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {empty ? (
        <EmptyState
          action={
            canEdit && !query ? (
              <Button onClick={() => setCreating(true)}>New project</Button>
            ) : undefined
          }
          description={
            query
              ? `No project name contains “${query}”.`
              : 'Save a design from the editor as a project, or start a new one here.'
          }
          icon={Folder01Icon}
          title={query ? 'No matching projects' : 'No projects yet'}
        />
      ) : (
        <ul aria-busy={page.loading} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.items.map((project) => (
            <li
              className="group overflow-hidden rounded-2xl bg-white/[0.015] ring-1 ring-white/[0.08]"
              key={project.id}
            >
              <Link
                aria-label={`Open ${project.name}`}
                className="block aspect-video"
                href={editorHref(project.id)}
              >
                <ProjectPreview alt={`Preview of ${project.name}`} document={project.document} />
              </Link>
              <div className="flex items-center gap-2 p-4">
                <div className="min-w-0 flex-1">
                  <Link
                    className="block truncate text-sm font-medium text-white hover:underline"
                    href={editorHref(project.id)}
                  >
                    {project.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Edited{' '}
                    {project.updatedAt.toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`Actions for ${project.name}`}
                        size="icon"
                        variant="ghost"
                      >
                        <MoreHorizontalIcon size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => router.push(editorHref(project.id))}>
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => router.push(`/canvas/new?project=${project.id}`)}
                      >
                        Open in Canvas
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRenaming(project)}>
                        Rename…
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void duplicate(project)}>
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setDeleting(project)} variant="destructive">
                        Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {page.loading ? <p className="text-sm text-neutral-500">Loading projects…</p> : null}
      {page.next && !page.loading ? (
        <div className="flex justify-center">
          <Button onClick={() => void load(page.next)} variant="outline">
            Load more
          </Button>
        </div>
      ) : null}

      <ProjectNameDialog
        description="Start from a blank canvas. It saves as you work."
        label="Project name"
        maxLength={200}
        onOpenChange={setCreating}
        onSubmit={async (name) => {
          const project = await trpcClient.project.create.mutate({
            document: { image: { src: null }, version: DESIGN_DOCUMENT_VERSION },
            name,
          })
          router.push(editorHref(project.id))
        }}
        open={creating}
        submitLabel="Create project"
        title="New project"
      />
      <ProjectNameDialog
        initialName={renaming?.name ?? ''}
        label="Project name"
        maxLength={200}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return
          const project = await trpcClient.project.rename.mutate({ name, projectId: renaming.id })
          setPage((current) => ({
            ...current,
            items: current.items.map((item) =>
              item.id === project.id ? { ...item, name: project.name } : item
            ),
          }))
        }}
        open={renaming !== null}
        submitLabel="Rename"
        title="Rename project"
      />

      <AlertDialog
        onOpenChange={(open) => !open && !deletePending && setDeleting(null)}
        open={deleting !== null}
      >
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and its whole version history are deleted for everyone in the workspace.
              This cannot be undone. Images saved to Assets stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePending}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deletePending ? 'Deleting…' : 'Delete project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
