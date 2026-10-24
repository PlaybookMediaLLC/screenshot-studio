'use client'

import * as React from 'react'
import { registerNavigationGuard } from '@/lib/platform/navigation-guard'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { WriteData } from '@/app/[locale]/write/write-data'
import { libraryDraft } from '@/lib/write/library'
import type { DraftWire } from '@/lib/content-drafts/client'
import { toast } from 'sonner'
import { platformHref } from '@/lib/platform/navigation'
import { SOCIAL_SET_COOKIE } from '@/lib/settings/appearance'

/**
 * Write's shared client state (RFC 025): the library the page loaded, and
 * helpers to change the URL state it is filtered by. Panels and dialogs are
 * UI state only; nothing here is saved with a draft.
 */

/** The library a Write page loaded. */
export type WriteLibrary = WriteData

/** A brand as the browser holds it. */
export type WriteSet = WriteData['sets'][number]

/** A draft row in the library. */
export type LibraryDraft = WriteData['library'][number]

/** A set's tag in the library. */
export type LibraryTag = WriteData['tags'][number]

type WriteContextValue = {
  data: WriteLibrary
  /** The draft open in the main area, if any. */
  activeId?: string
  canEdit: boolean
  canManageSets: boolean
  canPublish: boolean
  canReview: boolean
  /** Update the library's URL state; undefined removes a key. */
  setQuery: (next: Record<string, string | undefined>) => void
  /** The draft list as last saved here: the open draft's line stays current. */
  showSaved: (draft: { excerpt: string; id: string; title: string; updatedAt: string }) => void
  hideDraft: (id: string) => void
  beforeLeaveRef: React.MutableRefObject<(() => Promise<void>) | null>
  saved: Record<string, { excerpt: string; title: string; updatedAt: string }>
}

const WriteContext = React.createContext<WriteContextValue | null>(null)

/** The Write context; every Write component sits inside a provider. */
export function useWrite(): WriteContextValue {
  const value = React.useContext(WriteContext)
  if (!value) throw new Error('useWrite outside WriteProvider')
  return value
}

/** Provides the library and its URL state to the Write components. */
export function WriteProvider({
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
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const beforeLeaveRef = React.useRef<(() => Promise<void>) | null>(null)
  React.useEffect(() => registerNavigationGuard(() => beforeLeaveRef.current?.()), [])
  React.useEffect(() => {
    const guard = (event: MouseEvent) => {
      const target = event.target as Element | null
      const link = target?.closest<HTMLAnchorElement>('a[href]')
      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        link.target ||
        link.download
      )
        return
      if (link.closest('[data-selecting="true"]')) return
      const url = new URL(link.href)
      if (
        url.origin !== window.location.origin ||
        url.pathname === window.location.pathname ||
        !beforeLeaveRef.current
      )
        return
      event.preventDefault()
      event.stopPropagation()
      void beforeLeaveRef
        .current()
        .then(() => router.push(url.pathname + url.search + url.hash))
        .catch(() => {})
    }
    document.addEventListener('click', guard, true)
    return () => document.removeEventListener('click', guard, true)
  }, [router])
  const [removed, setRemoved] = React.useState<string[]>([])
  const hideDraft = React.useCallback(
    (id: string) => {
      // A confirmed deletion must not try to flush the now-missing draft on its way out.
      if (id === activeId) beforeLeaveRef.current = null
      setRemoved((current) => [...current, id])
    },
    [activeId]
  )
  const [saved, setSaved] = React.useState<WriteContextValue['saved']>({})
  const setQuery = React.useCallback(
    (next: Record<string, string | undefined>) => {
      const query = new URLSearchParams(window.location.search)
      for (const [key, value] of Object.entries(next)) {
        if (value) query.set(key, value)
        else query.delete(key)
      }
      const href = `${pathname}${query.size > 0 ? `?${query}` : ''}`
      if (Object.keys(next).every((key) => key === 'q')) {
        window.history.replaceState(null, '', href)
      } else {
        router.replace(href, { scroll: false })
      }
    },
    [pathname, router]
  )
  const showSaved = React.useCallback<WriteContextValue['showSaved']>(
    ({ id, ...draft }) => setSaved((current) => ({ ...current, [id]: draft })),
    []
  )
  const search = params.get('q') ?? ''
  const [results, setResults] = React.useState<{ key: string; items: LibraryDraft[] } | null>(null)
  const searchQuery = new URLSearchParams({
    limit: '100',
    search,
    view: data.query.tab === 'queue' ? 'drafts' : data.query.tab,
  })
  if (data.activeSet) searchQuery.set('socialSetId', data.activeSet.id)
  if (data.query.kind) searchQuery.set('kind', data.query.kind)
  if (data.query.sort) searchQuery.set('sort', data.query.sort)
  if (data.experiments.tags && data.query.tag) searchQuery.set('tagId', data.query.tag)
  const searchKey = searchQuery.toString()
  React.useEffect(() => {
    if (!search || !data.hasMore) return
    // Search beyond the loaded page through JSON, without remounting the route.
    const controller = new AbortController()
    void fetch(`/api/v1/content-drafts?${searchKey}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Search failed. Try again.')
        const page = (await response.json()) as { pinned: DraftWire[]; items: DraftWire[] }
        if (!controller.signal.aborted)
          setResults({ key: searchKey, items: [...page.pinned, ...page.items].map(libraryDraft) })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          toast.error('Search failed. Showing matches from loaded drafts.')
      })
    return () => controller.abort()
  }, [data.hasMore, search, searchKey])
  const visibleData = React.useMemo(
    () => ({
      ...data,
      query: { ...data.query, q: search || undefined },
      library: (data.hasMore && results?.key === searchKey ? results.items : data.library).filter(
        (draft) => {
          if (removed.includes(draft.id)) return false
          const latest = saved[draft.id]
          return `${latest?.title ?? draft.title} ${draft.searchText} ${latest?.excerpt ?? ''}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase())
        }
      ),
    }),
    [data, removed, results, saved, search, searchKey]
  )
  const value = React.useMemo(
    () => ({
      beforeLeaveRef,
      hideDraft,
      activeId,
      canEdit,
      canManageSets,
      canPublish,
      canReview,
      data: visibleData,
      saved,
      setQuery,
      showSaved,
    }),
    [
      activeId,
      canEdit,
      canManageSets,
      canPublish,
      canReview,
      hideDraft,
      visibleData,
      saved,
      setQuery,
      showSaved,
    ]
  )
  return <WriteContext.Provider value={value}>{children}</WriteContext.Provider>
}

/** The URL of a draft, keeping the library's set so links stay in the workspace's context. */
export function draftHref(id: string, setId?: string | null, panel?: string): string {
  const query = new URLSearchParams()
  if (setId) query.set('set', setId)
  if (panel) query.set('panel', panel)
  return `/write/${encodeURIComponent(id)}${query.size > 0 ? `?${query}` : ''}`
}

/** "now", "5m", "3h", "2d", then a date: how long ago something happened. */
export function since(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 60 / 24)}d`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Remember the set chosen last, for the next visit. */
export function rememberSet(id: string): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie, read by the server
  document.cookie = `${SOCIAL_SET_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
}

/** Save the open document before a programmatic navigation. */
export function useWriteRouter() {
  const router = useRouter()
  const pathname = usePathname()
  const { beforeLeaveRef } = useWrite()
  return React.useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        args[0] = platformHref(pathname, args[0])
        if (!beforeLeaveRef.current) return router.push(...args)
        void beforeLeaveRef
          .current()
          .then(() => router.push(...args))
          .catch(() => {})
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        args[0] = platformHref(pathname, args[0])
        if (!beforeLeaveRef.current) return router.replace(...args)
        void beforeLeaveRef
          .current()
          .then(() => router.replace(...args))
          .catch(() => {})
      },
    }),
    [beforeLeaveRef, pathname, router]
  )
}
