'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  BatchItem,
  BatchItemInput,
  BatchMedia,
  BatchValidation,
  ContentBatch,
} from '@/lib/api/contracts/content-batches'
import { call, DraftRequestError, draftsApi } from '@/lib/content-drafts/client'
import { assetContentUrl } from '@/lib/editor/services'
import { useTRPCClient } from '@/lib/trpc/react'
import {
  type BatchAccount,
  pendingAccounts,
  POST_STATUS,
  postOn,
  queueTimings,
  readTiming,
  spreadTimings,
  stagedChecks,
} from '@/lib/write/batch'
import {
  channelProblem,
  type ImportMapping,
  type ImportRow,
  matchRowMedia,
  parseBatchCSV,
  unusedFiles,
} from '@/lib/write/bulk-import'
import { importedBody, importedPosts } from '@/lib/write/import-text'
import { readVersions, withOptions } from '@/lib/write/versions'
import { saveExportToWorkspace } from '@/lib/workspace/save-export'

/** Files a batch takes: the formats some destination publishes; a PDF goes to LinkedIn as a document. */
const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf'
/** Uploads at once: enough to keep a link busy, few enough to bound memory and sockets. */
const UPLOAD_CONCURRENCY = 3
const ITEM_LIMIT = 50

type Staged = { input: BatchItemInput; line: number; problems: string[] }
type Upload = { progress: number; error?: string }

/** A path a person can read: '2026-11-03 09:30 (Europe/Paris)'. */
function when(at: Date | string, zone: string) {
  const date = typeof at === 'string' ? new Date(at) : at
  return `${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone || undefined })}${zone ? ` (${zone})` : ''}`
}

/** A random retry key for an item and its draft. */
const importKey = () => `batch-${crypto.randomUUID()}`

/**
 * Bulk scheduling (RFC 042): many separate posts, each its own draft. The
 * batch lives in the backend, so a reload, a closed tab or another device
 * reopens it; only the files chosen in this tab live here, and an upload cut
 * short asks for its file again instead of claiming it finished.
 */
export function BatchWorkspace({
  initial,
  accounts,
  canPublish,
}: {
  initial: ContentBatch
  accounts: BatchAccount[]
  canPublish: boolean
}) {
  const trpc = useTRPCClient()
  const [batch, setBatch] = React.useState(initial)
  const items = React.useMemo(() => batch.items ?? [], [batch.items])
  const zone = batch.timeZone || 'UTC'
  const base = `/api/v1/content-batches/${encodeURIComponent(batch.id)}`
  const reload = React.useCallback(async () => {
    setBatch(await call<ContentBatch>(base))
  }, [base])
  const replaceItem = (next: BatchItem) =>
    setBatch((current) => ({
      ...current,
      items: (current.items ?? []).map((item) => (item.id === next.id ? next : item)),
    }))

  // Files chosen in this tab, by name; a reload forgets them on purpose.
  const files = React.useRef(new Map<string, File>())
  const [uploads, setUploads] = React.useState<Record<string, Upload>>({})
  const queue = React.useRef<{ itemId: string; index: number }[]>([])
  const running = React.useRef(0)
  const itemsRef = React.useRef(items)
  itemsRef.current = items

  const patchMedia = React.useCallback(
    async (itemId: string, index: number, entry: BatchMedia) => {
      const item = itemsRef.current.find((candidate) => candidate.id === itemId)
      if (!item) return
      const media = item.media.map(({ assetId, fileName, bytes, uploadAssetId }, at): BatchMedia =>
        at === index
          ? entry
          : assetId
            ? { assetId }
            : { fileName: fileName!, bytes: bytes!, ...(uploadAssetId ? { uploadAssetId } : {}) }
      )
      const next = await call<BatchItem>(`${base}/items/${encodeURIComponent(itemId)}`, {
        body: { media },
        method: 'PATCH',
      })
      itemsRef.current = itemsRef.current.map((candidate) =>
        candidate.id === itemId ? next : candidate
      )
      replaceItem(next)
    },
    [base]
  )

  const pump = React.useCallback(() => {
    while (running.current < UPLOAD_CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!
      const item = itemsRef.current.find((candidate) => candidate.id === job.itemId)
      const entry = item?.media[job.index]
      const file = entry?.fileName ? files.current.get(entry.fileName) : undefined
      if (!item || !entry?.fileName || !file || entry.assetId) continue
      const key = `${job.itemId}/${job.index}`
      running.current += 1
      setUploads((current) => ({ ...current, [key]: { progress: 0 } }))
      void saveExportToWorkspace({
        blob: file,
        fileName: entry.fileName,
        trpcClient: trpc,
        // Record the reservation first: after a reload it tells an upload
        // that was cut short from one that never started.
        onReserved: (assetId) =>
          patchMedia(job.itemId, job.index, {
            fileName: entry.fileName!,
            bytes: file.size,
            uploadAssetId: assetId,
          }),
        onProgress: (progress) => setUploads((current) => ({ ...current, [key]: { progress } })),
      })
        .then(({ assetId }) =>
          patchMedia(job.itemId, job.index, { assetId, fileName: entry.fileName })
        )
        .then(() => setUploads(({ [key]: _done, ...rest }) => rest))
        .catch((error: unknown) =>
          setUploads((current) => ({
            ...current,
            [key]: {
              progress: 0,
              error: error instanceof Error ? error.message : 'Upload failed.',
            },
          }))
        )
        .finally(() => {
          running.current -= 1
          pump()
        })
    }
  }, [patchMedia, trpc])

  /** Queue every attachment whose file this tab holds and that is not stored yet. */
  const startUploads = React.useCallback(() => {
    for (const item of itemsRef.current) {
      item.media.forEach((entry, index) => {
        const key = `${item.id}/${index}`
        if (entry.assetId || !entry.fileName || !files.current.has(entry.fileName)) return
        if (entry.status === 'UPLOADED' || uploads[key]?.progress !== undefined) return
        if (queue.current.some((job) => job.itemId === item.id && job.index === index)) return
        queue.current.push({ itemId: item.id, index })
      })
    }
    pump()
  }, [pump, uploads])

  // After a reload, finish uploads whose bytes arrived before the page closed.
  React.useEffect(() => {
    for (const item of initial.items ?? []) {
      item.media.forEach((entry, index) => {
        if (entry.status !== 'PENDING' || !entry.uploadAssetId || !entry.fileName) return
        void trpc.asset.completeUpload
          .mutate({ assetId: entry.uploadAssetId })
          .then(() =>
            patchMedia(item.id, index, { assetId: entry.uploadAssetId!, fileName: entry.fileName })
          )
          .catch(() =>
            // Its bytes never arrived: forget the reservation and ask for the file again.
            patchMedia(item.id, index, { fileName: entry.fileName!, bytes: entry.bytes! })
          )
      })
    }
  }, [initial.items, patchMedia, trpc])

  const missingFiles = items.flatMap((item) =>
    item.media.filter(
      (entry) => !entry.assetId && entry.fileName && !files.current.has(entry.fileName)
    )
  )

  // Adding items: selected files, a CSV and shared settings, previewed first.
  const [csv, setCSV] = React.useState('')
  const [chosen, setChosen] = React.useState<File[]>([])
  const [sharedCaption, setSharedCaption] = React.useState('')
  const [sharedAccounts, setSharedAccounts] = React.useState<string[]>(
    accounts.map((account) => account.id)
  )
  const [preview, setPreview] = React.useState<{
    mapping: ImportMapping | null
    staged: Staged[]
    unused: string[]
  } | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const previewImport = async () => {
    try {
      if (chosen.length + items.length > ITEM_LIMIT && !csv.trim())
        throw new Error(
          `A batch holds up to ${ITEM_LIMIT} posts. Choose fewer files or start another batch.`
        )
      const known = new Set<string>()
      let mapping: ImportMapping | null = null
      let rows: ImportRow[]
      if (csv.trim()) {
        const parsed = parseBatchCSV(csv)
        mapping = parsed.mapping
        rows = parsed.rows
        // Confirm each asset ID the CSV names belongs to this workspace.
        const ids = [...new Set(rows.flatMap((row) => row.assets))].filter(
          (token) => !chosen.some((file) => file.name === token)
        )
        await Promise.all(
          ids.map(async (id) => {
            const response = await fetch(assetContentUrl(id), {
              headers: { Range: 'bytes=0-0' },
            }).catch(() => null)
            await response?.body?.cancel()
            if (response?.ok) known.add(id)
          })
        )
      } else {
        rows = chosen.map((file, index) => ({
          line: index + 1,
          caption: '',
          assets: [file.name],
          channels: [],
          problems: [],
        }))
      }
      const connected = accounts.map((account) => account.channel)
      const staged = rows.map((row): Staged => {
        const matched = matchRowMedia(row, chosen, known)
        const channelIssue = channelProblem(row.channels, connected)
        const chosenAccounts = row.channels.length
          ? accounts
              .filter((account) => row.channels.includes(account.channel))
              .map((account) => account.id)
          : sharedAccounts
        return {
          line: row.line,
          problems: [...row.problems, ...matched.problems, ...(channelIssue ? [channelIssue] : [])],
          input: {
            importKey: importKey(),
            caption: row.caption || sharedCaption,
            media: matched.media,
            channelConnectionIds: chosenAccounts,
            timing: row.time
              ? { mode: 'time', localTime: row.time, timeZone: row.timeZone ?? zone }
              : {},
          },
        }
      })
      if (items.length + staged.length > ITEM_LIMIT)
        throw new Error(
          `A batch holds up to ${ITEM_LIMIT} posts; this would make ${items.length + staged.length}.`
        )
      setPreview({ mapping, staged, unused: csv.trim() ? unusedFiles(rows, chosen) : [] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this import.')
    }
  }

  const addValid = async () => {
    if (!preview) return
    const valid = preview.staged.filter((row) => row.problems.length === 0)
    if (!valid.length) return
    setBusy('add')
    try {
      for (const file of chosen) files.current.set(file.name, file)
      const next = await call<ContentBatch>(`${base}/items`, {
        body: { items: valid.map((row) => row.input) },
        method: 'POST',
      })
      setBatch(next)
      itemsRef.current = next.items ?? []
      // Rows that were not added stay listed with their problems, so none is lost unseen.
      const left = preview.staged.filter((row) => row.problems.length > 0)
      setPreview(left.length ? { mapping: preview.mapping, staged: left, unused: [] } : null)
      setCSV('')
      setChosen([])
      startUploads()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The items could not be added.')
    } finally {
      setBusy(null)
    }
  }

  const reselect = (selected: File[]) => {
    for (const file of selected) {
      const wanted = missingFiles.find((entry) => entry.fileName === file.name)
      if (wanted && wanted.bytes === file.size) files.current.set(file.name, file)
    }
    startUploads()
    setUploads((current) => ({ ...current }))
  }

  const updateItem = async (item: BatchItem, body: Record<string, unknown>) => {
    try {
      replaceItem(
        await call<BatchItem>(`${base}/items/${encodeURIComponent(item.id)}`, {
          body,
          method: 'PATCH',
        })
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The item could not be saved.')
    }
  }

  // Bulk actions on staged items, with each item's own values kept unless asked.
  const applyShared = async (what: 'caption' | 'accounts') => {
    setBusy(what)
    for (const item of items) {
      if (item.draftId) continue
      if (what === 'caption' && item.caption.trim()) continue
      await updateItem(
        item,
        what === 'caption' ? { caption: sharedCaption } : { channelConnectionIds: sharedAccounts }
      )
    }
    setBusy(null)
  }

  const [timesMode, setTimesMode] = React.useState<'queue' | 'spread'>('queue')
  const [spread, setSpread] = React.useState({ start: '', perDay: 2, spacing: 240, shift: 0 })
  const [seed] = React.useState(() => crypto.randomUUID())
  const planTimes = async () => {
    const targets = items.filter(
      (item) =>
        pendingAccounts(item, item.draft?.channelConnectionIds ?? item.channelConnectionIds)
          .remaining.length > 0
    )
    if (!targets.length) return
    setBusy('times')
    try {
      const { times } = await call<{ times: string[] }>('/api/v1/content-draft-batch/times', {
        method: 'POST',
        body:
          timesMode === 'queue'
            ? { socialSetId: batch.socialSetId, count: targets.length, mode: 'queue', seed }
            : {
                socialSetId: batch.socialSetId,
                count: targets.length,
                mode: 'spread',
                localTime: spread.start,
                postsPerDay: spread.perDay,
                spacingMinutes: spread.spacing,
                shiftMinutes: spread.shift,
                seed,
              },
      })
      const timings = timesMode === 'queue' ? queueTimings(times) : spreadTimings(times, zone)
      for (const [index, item] of targets.entries())
        await updateItem(item, { timing: timings[index] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The times could not be planned.')
    } finally {
      setBusy(null)
    }
  }

  // Drafts: each finished item becomes its own draft; a retry returns the same one.
  const saveDrafts = async () => {
    setBusy('drafts')
    let failed = 0
    for (const item of itemsRef.current) {
      if (item.draftId || item.media.some((entry) => !entry.assetId)) continue
      try {
        const posts = importedPosts(item.caption)
        const body = importedBody(posts.length ? posts : [''])
        const pdf = item.media.find((entry) => entry.mediaType === 'application/pdf')
        for (const entry of item.media)
          body.push({
            type: entry === pdf ? 'file' : entry.mediaType?.startsWith('video/') ? 'video' : 'img',
            assetId: entry.assetId!,
            url: assetContentUrl(entry.assetId!),
            ...(entry.mediaType ? { mimeType: entry.mediaType } : {}),
            name: entry.fileName ?? '',
            children: [{ text: '' }],
          })
        replaceItem(
          await call<BatchItem>(`${base}/items/${encodeURIComponent(item.id)}/draft`, {
            method: 'POST',
            body: {
              title: item.caption.trim().slice(0, 80) || item.media[0]?.fileName || 'Batch post',
              body,
              plainText: item.caption,
              assetIds: item.media.map((entry) => entry.assetId!),
              ...(pdf
                ? {
                    platformVersions: withOptions(readVersions(undefined), 'linkedin', {
                      document: {
                        assetId: pdf.assetId!,
                        title: pdf.fileName?.replace(/\.pdf$/i, '').slice(0, 200) || 'Document',
                      },
                    }),
                  }
                : {}),
            },
          })
        )
      } catch (error) {
        failed += 1
        toast.error(error instanceof Error ? error.message : 'A draft could not be saved.')
      }
    }
    setBusy(null)
    if (failed)
      toast.error(
        `${failed} item${failed === 1 ? '' : 's'} could not be saved; the rest are drafts.`
      )
  }

  const requestReviews = async () => {
    setBusy('review')
    for (const item of items) {
      if (
        !item.draftId ||
        item.draft?.reviewStatus === 'approved' ||
        item.draft?.reviewStatus === 'pending'
      )
        continue
      await draftsApi.review(item.draftId, { action: 'request' }).catch(() => null)
    }
    await reload()
    setBusy(null)
  }

  // Checking and scheduling: every item and account apart, chosen explicitly.
  const [verdicts, setVerdicts] = React.useState<Record<string, BatchValidation>>({})
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [outcomes, setOutcomes] = React.useState<Record<string, string>>({})
  const verdictKey = (itemId: string, accountId: string) => `${itemId}/${accountId}`
  const check = async () => {
    setBusy('check')
    try {
      const requests = items.flatMap((item) => {
        const { remaining } = pendingAccounts(
          item,
          item.draft?.channelConnectionIds ?? item.channelConnectionIds
        )
        return remaining.length ? [{ itemId: item.id, channelConnectionIds: remaining }] : []
      })
      if (!requests.length) {
        setVerdicts({})
        return
      }
      const { results } = await call<{ results: BatchValidation[] }>(`${base}/validate`, {
        body: { items: requests },
        method: 'POST',
      })
      // A time the browser reads differently (a skipped hour) is the item's problem too.
      const next: Record<string, BatchValidation> = {}
      for (const result of results)
        next[verdictKey(result.itemId, result.channelConnectionId)] = result
      setVerdicts(next)
      setSelected(
        Object.fromEntries(
          results.map((result) => [
            verdictKey(result.itemId, result.channelConnectionId),
            result.valid,
          ])
        )
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The batch could not be checked.')
    } finally {
      setBusy(null)
    }
  }
  const chosenCount = Object.entries(selected).filter(
    ([key, on]) => on && verdicts[key]?.valid
  ).length
  const attention = Object.values(verdicts).filter((verdict) => !verdict.valid).length

  const schedule = async () => {
    setBusy('schedule')
    const results: Record<string, string> = {}
    for (const item of items) {
      if (!item.draftId || !item.draft) continue
      const ids = Object.entries(selected)
        .filter(([key, on]) => on && key.startsWith(`${item.id}/`) && verdicts[key]?.valid)
        .map(([key]) => key.slice(item.id.length + 1))
      if (!ids.length) continue
      const timing = item.timing
      try {
        await draftsApi.schedule(item.draftId, {
          channelConnectionIds: ids,
          version: item.draft.version,
          add: pendingAccounts(item, ids).add,
          naturalPostingTime: false,
          ...(timing.mode === 'queue'
            ? { queue: true, expectedQueueSlot: timing.expectedQueueSlot }
            : {
                localTime: timing.localTime,
                timeZone: timing.timeZone,
                disambiguation: timing.disambiguation,
              }),
        })
        results[item.id] = 'Scheduled'
      } catch (error) {
        // One item's failure keeps the others; it can be corrected and sent again.
        results[item.id] =
          error instanceof DraftRequestError
            ? error.message
            : 'No confirmation received. Check again before retrying.'
      }
      setOutcomes({ ...results })
    }
    await reload()
    setVerdicts({})
    setSelected({})
    setBusy(null)
  }

  const archive = async () => {
    await call(`${base}/archive`, { method: 'POST' })
    window.location.assign('/write')
  }

  const accountName = (id: string) =>
    accounts.find((account) => account.id === id)?.name ?? 'Removed account'

  return (
    <section className="mx-auto grid max-w-5xl gap-6 p-6" data-testid="bulk-batch">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">{batch.title}</h1>
        <p className="text-sm text-muted-foreground">
          Bulk scheduling makes <strong>separate posts</strong>, one draft each, up to {ITEM_LIMIT}.
          To put several files in <strong>one post</strong>, attach them to a single draft instead.
          Times are shown in {zone}. This batch is saved as you go; reopen it from Write after a
          reload or on another device.
        </p>
        <p className="text-xs text-muted-foreground">
          {items.length} of {ITEM_LIMIT} items
        </p>
      </header>

      {missingFiles.length > 0 ? (
        <div role="status" className="grid gap-2 rounded-lg border border-amber-500/40 p-3 text-sm">
          <p>
            {missingFiles.length} file{missingFiles.length === 1 ? '' : 's'} did not finish
            uploading before the page closed:{' '}
            {[...new Set(missingFiles.map((entry) => entry.fileName))].join(', ')}. Select the same
            files again to continue; nothing else is lost.
          </p>
          <input
            aria-label="Select the files again"
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(event) => reselect(Array.from(event.target.files ?? []))}
          />
        </div>
      ) : null}

      {items.length < ITEM_LIMIT ? (
        <section className="grid gap-3 rounded-lg border p-4" aria-label="Add items">
          <h2 className="font-medium">Add items</h2>
          <label className="grid gap-1 text-sm">
            Photos, videos and PDFs for LinkedIn (one item each, or matched to CSV rows by file
            name)
            <input
              aria-label="Batch media files"
              type="file"
              multiple
              accept={ACCEPT}
              onChange={(event) => setChosen(Array.from(event.target.files ?? []))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            CSV: caption, asset (file names or workspace asset IDs, separated by semicolons),
            channels, time, timezone
            <textarea
              aria-label="Batch CSV"
              rows={4}
              value={csv}
              placeholder={
                'caption,asset,channels,time\n"Launch day, finally",hero.png,x;linkedin,2026-11-03 09:30'
              }
              onChange={(event) => setCSV(event.target.value)}
              className="rounded-lg border bg-background p-2 font-mono text-xs"
            />
          </label>
          <input
            aria-label="Batch CSV file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file && file.size <= 1_000_000) void file.text().then(setCSV)
              else if (file) toast.error('CSV files must be smaller than 1 MB.')
            }}
          />
          <label className="grid gap-1 text-sm">
            Shared caption (used where an item has none)
            <textarea
              aria-label="Shared caption"
              rows={2}
              value={sharedCaption}
              onChange={(event) => setSharedCaption(event.target.value)}
              className="rounded-lg border bg-background p-2 text-sm"
            />
          </label>
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1">Shared accounts (where a row names no channels)</legend>
            {accounts.map((account) => (
              <label key={account.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={sharedAccounts.includes(account.id)}
                  onChange={(event) =>
                    setSharedAccounts((current) =>
                      event.target.checked
                        ? [...current, account.id]
                        : current.filter((id) => id !== account.id)
                    )
                  }
                />
                {account.name}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void previewImport()} disabled={!chosen.length && !csv.trim()}>
              Preview import
            </Button>
            {items.some((item) => !item.draftId) ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void applyShared('caption')}
                >
                  Apply shared caption to items without one
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void applyShared('accounts')}
                >
                  Apply shared accounts to unsaved items
                </Button>
              </>
            ) : null}
          </div>
          {preview ? (
            <div className="grid gap-2 text-sm" data-testid="import-preview">
              {preview.mapping ? (
                <p>
                  Columns:{' '}
                  {preview.mapping
                    .map((column) => `${column.header} → ${column.field ?? 'ignored'}`)
                    .join(' · ')}
                </p>
              ) : null}
              {preview.unused.length ? (
                <p>Not used by any row: {preview.unused.join(', ')}</p>
              ) : null}
              <ol className="grid gap-1">
                {preview.staged.map((row) => (
                  <li key={row.input.importKey} className="rounded border p-2">
                    <span className="font-medium">Row {row.line}</span> ·{' '}
                    {row.input.caption.slice(0, 80) || 'No caption'} ·{' '}
                    {row.input.media
                      .map((media) => ('assetId' in media && media.assetId) || media.fileName)
                      .join(', ') || 'No media'}{' '}
                    · {row.input.channelConnectionIds.map(accountName).join(', ') || 'No accounts'}
                    {row.input.timing.localTime
                      ? ` · ${row.input.timing.localTime.replace('T', ' ')} (${row.input.timing.timeZone})`
                      : ''}
                    {row.problems.map((problem) => (
                      <p key={problem} role="alert" className="text-red-600">
                        {problem}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
              <Button
                disabled={busy !== null || !preview.staged.some((row) => !row.problems.length)}
                onClick={() => void addValid()}
              >
                Add {preview.staged.filter((row) => !row.problems.length).length} ready rows
                {preview.staged.some((row) => row.problems.length)
                  ? ` (${preview.staged.filter((row) => row.problems.length).length} need fixing first)`
                  : ''}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-3 rounded-lg border p-4" aria-label="Times">
        <h2 className="font-medium">Times</h2>
        <p className="text-sm text-muted-foreground">
          Set each item’s time below, or fill the times of items not yet scheduled. Queue slots are
          a preview: a slot taken before you schedule is refused, not moved.
        </p>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            Plan
            <select
              aria-label="Batch time mode"
              className="rounded border bg-background p-2"
              value={timesMode}
              onChange={(event) => setTimesMode(event.target.value as 'queue' | 'spread')}
            >
              <option value="queue">Fill the queue</option>
              <option value="spread">Spread over days</option>
            </select>
          </label>
          {timesMode === 'spread' ? (
            <>
              <label className="grid gap-1">
                Start ({zone})
                <Input
                  type="datetime-local"
                  value={spread.start}
                  onChange={(event) => setSpread({ ...spread, start: event.target.value })}
                />
              </label>
              <label className="grid gap-1">
                Posts per day
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={spread.perDay}
                  onChange={(event) => setSpread({ ...spread, perDay: Number(event.target.value) })}
                />
              </label>
              <label className="grid gap-1">
                Minutes apart
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={spread.spacing}
                  onChange={(event) =>
                    setSpread({ ...spread, spacing: Number(event.target.value) })
                  }
                />
              </label>
              <label className="grid gap-1">
                Random shift (minutes)
                <Input
                  type="number"
                  min={0}
                  max={55}
                  step={5}
                  value={spread.shift}
                  onChange={(event) => setSpread({ ...spread, shift: Number(event.target.value) })}
                />
              </label>
            </>
          ) : null}
          <Button
            variant="outline"
            disabled={busy !== null || !items.length}
            onClick={() => void planTimes()}
          >
            Fill times
          </Button>
        </div>
      </section>

      <ol className="grid gap-3" aria-label="Batch items">
        {items.map((item, index) => {
          const timing = readTiming(item.timing)
          const accountIds = item.draft?.channelConnectionIds ?? item.channelConnectionIds
          const staged = stagedChecks(item, accounts)
          return (
            <li
              key={item.id}
              className="grid gap-2 rounded-lg border p-3 text-sm"
              data-testid="batch-item"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>
                  {index + 1}. {item.draft?.title ?? (item.caption.slice(0, 60) || 'Untitled post')}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {item.draftId ? (
                    <a
                      className="underline"
                      href={`/write/${item.draftId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open draft
                      {item.draft?.reviewStatus && item.draft.reviewStatus !== 'none'
                        ? ` · review ${item.draft.reviewStatus.replace('_', ' ')}`
                        : ''}
                    </a>
                  ) : (
                    'Not saved as a draft yet'
                  )}
                </span>
              </div>
              <ul className="flex flex-wrap gap-2 text-xs">
                {item.media.map((entry, at) => {
                  const upload = uploads[`${item.id}/${at}`]
                  return (
                    <li
                      key={`${entry.assetId ?? entry.fileName}-${at}`}
                      className="rounded border px-2 py-1"
                    >
                      {entry.fileName ?? entry.mediaType ?? 'Asset'} ·{' '}
                      {entry.status === 'UPLOADED'
                        ? `${entry.mediaType}${entry.durationMs ? ` · ${Math.round(entry.durationMs / 1000)} s` : ''}${entry.width ? ` · ${entry.width}×${entry.height}` : ''}`
                        : upload?.error
                          ? `Upload failed: ${upload.error}`
                          : upload
                            ? `Uploading ${upload.progress}%`
                            : entry.fileName && !files.current.has(entry.fileName)
                              ? 'Waiting for its file to be selected again'
                              : entry.status === 'FAILED'
                                ? 'Refused at upload; remove it or select a valid file'
                                : 'Waiting to upload'}
                    </li>
                  )
                })}
              </ul>
              {item.draftId ? (
                <p className="whitespace-pre-wrap text-muted-foreground">{item.draft?.plainText}</p>
              ) : (
                <textarea
                  aria-label={`Caption for item ${index + 1}`}
                  defaultValue={item.caption}
                  rows={3}
                  className="rounded border bg-background p-2"
                  onBlur={(event) => {
                    if (event.target.value !== item.caption)
                      void updateItem(item, { caption: event.target.value })
                  }}
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  Time ({item.timing.timeZone || zone})
                  <Input
                    aria-label={`Time for item ${index + 1}`}
                    type="datetime-local"
                    value={item.timing.mode === 'time' ? (item.timing.localTime ?? '') : ''}
                    onChange={(event) =>
                      void updateItem(item, {
                        timing: event.target.value
                          ? {
                              mode: 'time',
                              localTime: event.target.value,
                              timeZone: item.timing.timeZone || zone,
                            }
                          : {},
                      })
                    }
                  />
                </label>
                {timing.kind === 'problem' && /happens twice/.test(timing.text) ? (
                  <span className="flex gap-1">
                    {(['earlier', 'later'] as const).map((choice) => (
                      <Button
                        key={choice}
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void updateItem(item, {
                            timing: { ...item.timing, disambiguation: choice },
                          })
                        }
                      >
                        The {choice} one
                      </Button>
                    ))}
                  </span>
                ) : null}
                <span
                  className={timing.kind === 'problem' ? 'text-red-600' : 'text-muted-foreground'}
                >
                  {timing.kind === 'at'
                    ? `Goes out ${when(timing.at, timing.zone || zone)}`
                    : timing.text}
                </span>
                {!item.draftId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void call(`${base}/items/${encodeURIComponent(item.id)}`, {
                        method: 'DELETE',
                      }).then(reload)
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Check</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => {
                    const on = accountIds.includes(account.id)
                    const key = verdictKey(item.id, account.id)
                    const verdict = verdicts[key]
                    const post = postOn(item, account.id)
                    const local = staged.get(account.id)
                    return (
                      <tr key={account.id}>
                        <td>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              aria-label={`${account.name} for item ${index + 1}`}
                              disabled={Boolean(item.draftId) || busy !== null}
                              checked={on}
                              onChange={(event) =>
                                void updateItem(item, {
                                  channelConnectionIds: event.target.checked
                                    ? [...item.channelConnectionIds, account.id]
                                    : item.channelConnectionIds.filter((id) => id !== account.id),
                                })
                              }
                            />
                            {account.name}
                          </label>
                        </td>
                        <td>
                          {!on ? null : verdict ? (
                            <label className="flex items-start gap-1">
                              <input
                                type="checkbox"
                                aria-label={`Schedule item ${index + 1} on ${account.name}`}
                                disabled={!verdict.valid}
                                checked={Boolean(selected[key]) && verdict.valid}
                                onChange={(event) =>
                                  setSelected((current) => ({
                                    ...current,
                                    [key]: event.target.checked,
                                  }))
                                }
                              />
                              <span className={verdict.valid ? '' : 'text-red-600'}>
                                {verdict.valid
                                  ? `Ready · ${verdict.scheduledFor ? when(verdict.scheduledFor, verdict.timeZone) : ''}`
                                  : verdict.error}
                              </span>
                            </label>
                          ) : (
                            <span
                              className={
                                local?.problems.length ? 'text-red-600' : 'text-muted-foreground'
                              }
                            >
                              {[...(local?.problems ?? []), ...(local?.changes ?? [])].join(' ') ||
                                'Not checked yet'}
                            </span>
                          )}
                        </td>
                        <td>
                          {post ? (
                            <span>
                              {POST_STATUS[post.status] ?? post.status} ·{' '}
                              {when(post.scheduledFor, post.scheduleTimeZone ?? zone)}
                              {post.url ? (
                                <>
                                  {' '}
                                  ·{' '}
                                  <a
                                    className="underline"
                                    href={post.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View
                                  </a>
                                </>
                              ) : null}
                            </span>
                          ) : on ? (
                            'Not scheduled'
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {outcomes[item.id] ? (
                <p role={outcomes[item.id] === 'Scheduled' ? 'status' : 'alert'}>
                  {outcomes[item.id]}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>

      <section
        className="sticky bottom-0 grid gap-2 rounded-lg border bg-background p-4"
        aria-label="Save and schedule"
      >
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              busy !== null ||
              !items.some((item) => !item.draftId && item.media.every((entry) => entry.assetId))
            }
            onClick={() => void saveDrafts()}
          >
            {busy === 'drafts' ? 'Saving drafts…' : 'Save ready items as drafts'}
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null || !items.some((item) => item.draftId)}
            onClick={() => void requestReviews()}
          >
            Request review for drafts
          </Button>
          {canPublish ? (
            <>
              <Button
                variant="outline"
                disabled={busy !== null || !items.some((item) => item.draftId)}
                onClick={() => void check()}
              >
                {busy === 'check' ? 'Checking…' : 'Check every item and account'}
              </Button>
              <Button disabled={busy !== null || chosenCount === 0} onClick={() => void schedule()}>
                {busy === 'schedule' ? 'Scheduling…' : `Schedule ${chosenCount} selected`}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              A publisher schedules these drafts after review.
            </p>
          )}
          <Button variant="ghost" disabled={busy !== null} onClick={() => void archive()}>
            Close batch
          </Button>
        </div>
        {Object.keys(verdicts).length ? (
          <p role="status" className="text-sm">
            {chosenCount} selection{chosenCount === 1 ? '' : 's'} will be scheduled
            {attention
              ? `; ${attention} need${attention === 1 ? 's' : ''} attention and will not be`
              : ''}
            . Nothing goes out until you choose Schedule.
          </p>
        ) : null}
      </section>
    </section>
  )
}
