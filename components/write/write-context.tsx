'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { WriteData } from '@/app/[locale]/write/write-data'
import { SOCIAL_SET_COOKIE } from '@/lib/settings/appearance'

/**
 * Write's shared client state (RFC 042): the library the page loaded, and
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
  /** Update the library's URL state; undefined removes a key. */
  setQuery: (next: Record<string, string | undefined>) => void
  /** The draft list as last saved here: the open draft's line stays current. */
  showSaved: (draft: { excerpt: string; id: string; title: string; updatedAt: string }) => void
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
  children,
  data,
}: {
  activeId?: string
  canEdit: boolean
  canManageSets: boolean
  canPublish: boolean
  children: React.ReactNode
  data: WriteLibrary
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [saved, setSaved] = React.useState<WriteContextValue['saved']>({})
  const setQuery = React.useCallback(
    (next: Record<string, string | undefined>) => {
      const query = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(next)) {
        if (value) query.set(key, value)
        else query.delete(key)
      }
      router.replace(`${pathname}${query.size > 0 ? `?${query}` : ''}`, { scroll: false })
    },
    [params, pathname, router]
  )
  const showSaved = React.useCallback<WriteContextValue['showSaved']>(
    ({ id, ...draft }) => setSaved((current) => ({ ...current, [id]: draft })),
    []
  )
  const value = React.useMemo(
    () => ({ activeId, canEdit, canManageSets, canPublish, data, saved, setQuery, showSaved }),
    [activeId, canEdit, canManageSets, canPublish, data, saved, setQuery, showSaved]
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
export function since(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
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
