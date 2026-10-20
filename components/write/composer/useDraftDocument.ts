'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type { Value } from '@shots/platejs-editor/platejs'
import { DraftRequestError, type DraftWire, draftsApi } from '@/lib/content-drafts/client'
import {
  type DraftDiscussions,
  mergeDiscussions,
  readDiscussions,
} from '@/lib/content-drafts/discussions'
import { type DraftChannel, draftPlainText, serializeDraft } from '@/lib/content-drafts/serialize'
import {
  type Article,
  type DraftTarget,
  type PlatformVersions,
  primaryChannel,
} from '@/lib/write/document'
import { readVersions } from '@/lib/write/versions'

/**
 * A draft's document in the composer (RFC 042): the primary body, the
 * platform versions, the title, destinations, target and article, saved on
 * a short debounce against the version the editor last saw. A save that
 * meets a newer version reloads it (or, in a live session, merges comment
 * threads and saves again) instead of overwriting it.
 */

/** Where the last save stands. */
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error' | 'offline'

/** How long typing waits before a save. */
const AUTOSAVE_DELAY_MS = 800

/** The parts of a draft the composer edits and saves. */
export type DraftDocument = {
  article: Article | null
  channelConnectionIds: string[]
  primaryPlatform: DraftChannel
  target: DraftTarget | null
  title: string
  value: Value
  versions: PlatformVersions
}

/** The document a draft opens with: legacy per-channel text becomes manual versions. */
export function documentOf(draft: DraftWire): DraftDocument {
  return {
    article: draft.article,
    channelConnectionIds: draft.channelConnectionIds,
    primaryPlatform: primaryChannel(draft.primaryPlatform),
    target: draft.target,
    title: draft.title,
    value: draft.body as Value,
    versions: readVersions(
      draft.platformVersions,
      draft.channelText as Partial<Record<DraftChannel, string>>,
      draft.body
    ),
  }
}

/** The composer's draft state and its saving. */
export function useDraftDocument({
  canEdit,
  collaborating,
  draft,
  onSaved,
}: {
  canEdit: boolean
  /** In a live session every editor holds the same body. */
  collaborating: boolean
  draft: DraftWire
  onSaved?: (saved: DraftWire) => void
}) {
  const [document, setDocument] = React.useState<DraftDocument>(() => documentOf(draft))
  const [editorKey, setEditorKey] = React.useState(0)
  const [saveState, setSaveState] = React.useState<SaveState>('saved')
  const [server, setServer] = React.useState<DraftWire>(draft)
  const version = React.useRef(draft.version)
  const latest = React.useRef(document)
  latest.current = document
  const discussions = React.useRef(readDiscussions(draft.discussions))
  const dirty = React.useRef(false)
  const inFlight = React.useRef<Promise<void> | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const legacyText = React.useRef(Object.keys(draft.channelText).length > 0)

  const reloadLatest = React.useCallback(async () => {
    const fresh = await draftsApi.get(draft.id)
    version.current = fresh.version
    setServer(fresh)
    setDocument(documentOf(fresh))
    setEditorKey((key) => key + 1)
  }, [draft.id])

  const save = React.useCallback(async (): Promise<void> => {
    if (!canEdit) return
    if (inFlight.current) await inFlight.current
    const run = (async () => {
      setSaveState('saving')
      for (let attempt = 0; ; attempt += 1) {
        const next = latest.current
        dirty.current = false
        try {
          const saved = await draftsApi.save(draft.id, {
            article: next.article ?? undefined,
            assetIds: serializeDraft(next.value, 'linkedin').assetIds,
            baseVersion: version.current,
            body: next.value,
            channelConnectionIds: next.channelConnectionIds,
            // Legacy per-channel text moved into platform versions: clear it once.
            ...(legacyText.current ? { channelText: {} } : {}),
            discussions: discussions.current,
            plainText: draftPlainText(next.value),
            platformVersions: next.versions,
            primaryPlatform: next.primaryPlatform,
            target: next.target ?? undefined,
            title: next.title,
          })
          legacyText.current = false
          version.current = saved.version
          setServer(saved)
          setSaveState(dirty.current ? 'unsaved' : 'saved')
          onSaved?.(saved)
          return
        } catch (error) {
          if (
            error instanceof DraftRequestError &&
            error.status === 409 &&
            collaborating &&
            attempt < 3
          ) {
            // Another editor's autosave moved the version: save on top of it,
            // keeping the comment threads they saved as well as ours.
            const fresh = await draftsApi.get(draft.id)
            version.current = fresh.version
            discussions.current = mergeDiscussions(
              discussions.current,
              readDiscussions(fresh.discussions)
            )
            continue
          }
          if (error instanceof DraftRequestError && error.status === 409) {
            // Someone saved a newer version: show it rather than overwrite it.
            await reloadLatest()
            setSaveState('saved')
            toast.info(
              'This draft was changed elsewhere. Showing the latest version; your last edit was not saved.'
            )
            return
          }
          if (
            error instanceof DraftRequestError &&
            (error.status === 404 || error.status === 403)
          ) {
            setSaveState('error')
            toast.error('You no longer have access to this draft; nothing more is saved.')
            return
          }
          dirty.current = true
          setSaveState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error')
          return
        }
      }
    })()
    inFlight.current = run
    await run
    inFlight.current = null
  }, [canEdit, collaborating, draft.id, onSaved, reloadLatest])

  const scheduleSave = React.useCallback(() => {
    if (!canEdit) return
    dirty.current = true
    setSaveState('unsaved')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
  }, [canEdit, save])

  /** Change the document and save it shortly. */
  const update = React.useCallback(
    (change: Partial<DraftDocument> | ((current: DraftDocument) => Partial<DraftDocument>)) => {
      setDocument((current) => {
        const next = { ...current, ...(typeof change === 'function' ? change(current) : change) }
        latest.current = next
        return next
      })
      scheduleSave()
    },
    [scheduleSave]
  )

  /** Save now, waiting for any save in flight: before scheduling, sharing, or leaving. */
  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (dirty.current) await save()
    else if (inFlight.current) await inFlight.current
  }, [save])

  const onDiscussionsChange = React.useCallback(
    (next: DraftDiscussions) => {
      discussions.current = next
      scheduleSave()
    },
    [scheduleSave]
  )

  // A failed save retries when the network comes back, keeping the edits.
  React.useEffect(() => {
    const retry = () => {
      if (dirty.current) void save()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [save])
  // Leaving with unsaved edits asks first.
  React.useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  // A draft the server sent back (scheduled, archived, reviewed): newer
  // saves build on its version; a late, older answer never moves it back.
  const adopt = React.useCallback((next: DraftWire) => {
    version.current = Math.max(version.current, next.version)
    setServer(next)
  }, [])
  return {
    discussions,
    document,
    editorKey,
    flush,
    onDiscussionsChange,
    reloadLatest,
    saveState,
    server,
    setServer: adopt,
    update,
    versionRef: version,
  }
}
