'use client'

import * as React from 'react'
import { z } from 'zod'
import { contentDraftCreateSchema } from '@/lib/api/contracts/content-drafts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DraftRequestError, draftsApi } from '@/lib/content-drafts/client'
import { assetDownloadQuerySchema } from '@/lib/tenant/schemas'
import { workspaceUploadFile, assetContentUrl } from '@/lib/editor/services'
import { useTRPCClient } from '@/lib/trpc/react'
import { importedBody, importedPosts } from '@/lib/write/import-text'
import { readVersions, withOptions } from '@/lib/write/versions'
import { channelProblem, parseDraftCSV, type ImportRow } from '@/lib/write/bulk-import'
import { useWrite } from './write-context'
import { BulkScheduleDialog } from './bulk-schedule'

type Row = ImportRow & {
  key: string
  file?: File
  assetId?: string
  mime?: string
  id?: string
  error?: string
  definitiveFailure?: boolean
  request?: Parameters<typeof draftsApi.create>[0]
}

/** Upload once, create an idempotent draft per row, then use ordinary review and scheduling. */
export function BulkImportDialog({ onClose }: { onClose: () => void }) {
  const { data, beforeLeaveRef } = useWrite()
  const client = useTRPCClient()
  const [rows, setRows] = React.useState<Row[]>([])
  const [busy, setBusy] = React.useState(false)
  const [scheduling, setScheduling] = React.useState(false)
  const [csv, setCSV] = React.useState('caption,asset,channels\n')
  const [files, setFiles] = React.useState<File[]>([])
  const set = data.activeSet
  const connected = set?.accounts.map((account) => account.channel) ?? []
  // A saved request already resolved its accounts; check the rest before creating anything.
  const problem = (row: Row) =>
    row.id || row.request ? undefined : channelProblem(row.channels, connected)
  const storageKey = `shots:import:${data.importStorageScope}:${set?.id}`
  const [restored, setRestored] = React.useState(false)
  const [confirmReset, setConfirmReset] = React.useState(false)
  const persist = (next: Row[]) => {
    // Keep immutable request metadata and receipts in this tab, never uploaded bytes.
    sessionStorage.setItem(storageKey, JSON.stringify(next.map(({ file: _file, ...row }) => row)))
  }
  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) {
        const rowSchema = z.object({
          key: z.uuid(),
          caption: z.string().max(100_000),
          asset: z.string().max(1024),
          channels: z.array(z.string()).max(6),
          assetId: z.string().optional(),
          mime: z.string().optional(),
          id: z.string().optional(),
          error: z.string().optional(),
          definitiveFailure: z.boolean().optional(),
          request: contentDraftCreateSchema.optional(),
        })
        setRows(z.array(rowSchema).max(50).parse(JSON.parse(saved)))
        setRestored(true)
      }
    } catch {
      try {
        sessionStorage.removeItem(storageKey)
      } catch {
        /* Browser storage may be disabled. */
      }
    }
  }, [storageKey])
  const build = () => {
    try {
      if (
        files.length > 50 ||
        files.reduce((total, file) => total + file.size, 0) > 500 * 1024 * 1024
      )
        throw new Error('Choose up to 50 files, at most 500 MB total.')
      const parsed =
        csv.trim() === 'caption,asset,channels'
          ? files.map((file) => ({ caption: '', asset: file.name, channels: [] }))
          : parseDraftCSV(csv)
      if (!parsed.length || parsed.length > 50) throw new Error('Choose between 1 and 50 items.')
      if (new Set(files.map((file) => file.name)).size !== files.length)
        throw new Error('Selected filenames must be unique.')
      const next = parsed.map((row) => ({
        ...row,
        key: crypto.randomUUID(),
        file: files.find((file) => file.name === row.asset),
      }))
      persist(next)
      setRows(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this batch.')
    }
  }
  const create = async () => {
    if (!set) return
    setBusy(true)
    try {
      await beforeLeaveRef.current?.()
      for (const row of rows) {
        if (row.id || problem(row)) continue
        try {
          row.definitiveFailure = false
          if (row.request) {
            const draft = await draftsApi.create(row.request)
            row.id = draft.id
            row.error = undefined
            persist(rows)
            setRows((current) => [...current])
            continue
          }
          const accounts = row.channels.length
            ? row.channels.map((channel) => {
                const account = set.accounts.find((account) => account.channel === channel)
                if (!account) throw new Error(`No connected ${channel} account in this set.`)
                return account
              })
            : set.accounts
          const posts = importedPosts(row.caption)
          const body = importedBody(posts.length ? posts : [''])
          if (row.asset && !row.assetId) {
            if (row.file) {
              const uploaded = await workspaceUploadFile(client)(row.file)
              if (!uploaded.assetId) throw new Error('Upload did not return an asset.')
              row.assetId = uploaded.assetId
              row.mime = row.file.type
              persist(rows)
            } else {
              // Existing exports are authorized through the ordinary asset read path.
              if (!assetDownloadQuerySchema.safeParse({ assetId: row.asset }).success)
                throw new Error('Select the matching file again, or enter a workspace asset ID.')
              const response = await fetch(assetContentUrl(row.asset), {
                headers: { Range: 'bytes=0-0' },
              })
              await response.body?.cancel()
              if (!response.ok) throw new Error('This workspace asset is unavailable.')
              const mime = response.headers.get('content-type')?.split(';')[0] ?? ''
              if (
                !mime.startsWith('image/') &&
                !['video/mp4', 'video/webm', 'application/pdf'].includes(mime)
              )
                throw new Error('Use an image, video, or PDF asset.')
              row.assetId = row.asset
              row.mime = mime
              persist(rows)
            }
          }
          if (
            row.mime === 'application/pdf' &&
            accounts.some((account) => account.channel !== 'linkedin')
          )
            throw new Error(
              'PDF carousels require a LinkedIn-only row. Set its channels to linkedin.'
            )
          if (row.assetId)
            body.push({
              type: row.mime?.startsWith('video/')
                ? 'video'
                : row.mime === 'application/pdf'
                  ? 'file'
                  : 'img',
              assetId: row.assetId,
              url: assetContentUrl(row.assetId),
              name: row.asset,
              children: [{ text: '' }],
            })
          if (!row.caption.trim() && !row.assetId) throw new Error('Add a caption or an asset.')
          row.request = {
            ...(row.mime === 'application/pdf' && row.assetId
              ? {
                  platformVersions: withOptions(readVersions(undefined), 'linkedin', {
                    document: {
                      assetId: row.assetId,
                      title: row.asset.replace(/\.pdf$/i, '').slice(0, 200) || 'Document',
                    },
                  }),
                }
              : {}),
            importKey: row.key,
            socialSetId: set.id,
            title: row.caption.trim().slice(0, 80) || row.asset || 'Imported media',
            body,
            plainText: row.caption,
            assetIds: row.assetId ? [row.assetId] : [],
            channelConnectionIds: accounts.map((account) => account.id),
          }
          persist(rows)
          const draft = await draftsApi.create(row.request)
          row.id = draft.id
          row.error = undefined
        } catch (error) {
          row.error = error instanceof Error ? error.message : 'Import failed.'
          // Only a definite rejection permits editing/discarding an attempted
          // row. A timeout/5xx keeps its immutable receipt for reconciliation.
          row.definitiveFailure =
            error instanceof DraftRequestError && [400, 401, 403, 404, 422].includes(error.status)
        }
        persist(rows)
        setRows((current) => [...current])
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save import progress. Keep this tab open and retry.'
      )
    } finally {
      setBusy(false)
    }
  }
  if (scheduling)
    return (
      <BulkScheduleDialog
        selected={rows.flatMap((row) => (row.id ? [row.id] : []))}
        onClose={onClose}
      />
    )
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="bulk-import">
        <DialogHeader>
          <DialogTitle>Import drafts in bulk</DialogTitle>
          <DialogDescription>
            Create up to 50 editable drafts. Review and approval still apply before publishing. CSV
            columns: caption, asset (workspace asset ID or selected filename), channels (separated
            by semicolons).
          </DialogDescription>
        </DialogHeader>
        {restored && rows.length > 0 ? (
          <p role="status">
            Resumed this tab’s import. Created drafts and retry keys are preserved. Select any files
            that had not finished uploading again.
          </p>
        ) : null}
        {rows.length > 0 &&
        rows.some((row) => row.asset && !row.assetId && !row.request && !row.file) ? (
          <Label className="grid gap-1.5 text-sm font-medium">
            Files to resume
            <Input
              aria-label="Resume batch files"
              className="text-sm text-muted-foreground file:me-3 file:rounded-full file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-foreground/[0.04]"
              type="file"
              multiple
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? [])
                if (
                  new Set(selected.map((file) => file.name)).size !== selected.length ||
                  selected.length > 50 ||
                  selected.reduce((sum, file) => sum + file.size, 0) > 500 * 1024 * 1024
                ) {
                  toast.error('Choose up to 50 files with unique names, at most 500 MB total.')
                  return
                }
                setRows((current) =>
                  current.map((row) => ({
                    ...row,
                    file: selected.find((file) => file.name === row.asset) ?? row.file,
                  }))
                )
              }}
            />
          </Label>
        ) : null}
        {!rows.length ? (
          <>
            <Label className="grid gap-1.5 text-sm font-medium">
              Images, videos, or design exports
              <Input
                aria-label="Batch media files"
                className="text-sm text-muted-foreground file:me-3 file:rounded-full file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-foreground/[0.04]"
                type="file"
                multiple
                accept="image/*,video/mp4,video/webm,application/pdf"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </Label>
            <Label className="grid gap-1.5 text-sm font-medium">
              CSV file
              <Input
                aria-label="Batch CSV file"
                className="text-sm text-muted-foreground file:me-3 file:rounded-full file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-foreground/[0.04]"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file && file.size <= 1_000_000) void file.text().then(setCSV)
                  else toast.error('CSV files must be smaller than 1 MB.')
                }}
              />
            </Label>
            <Label className="grid gap-1.5 text-sm font-medium">
              Or paste CSV
              <Textarea
                aria-label="Batch CSV"
                rows={6}
                value={csv}
                placeholder={'caption,asset,channels\n"Launch day",hero.png,x;linkedin'}
                onChange={(event) => setCSV(event.target.value)}
                className="w-full rounded-lg border border-input bg-background p-3 font-mono text-xs font-normal field-sizing-fixed md:text-xs"
              />
            </Label>
            <Button onClick={build}>Review import</Button>
          </>
        ) : (
          <>
            <ol className="grid gap-2">
              {rows.map((row, index) => (
                <li key={row.key} className="rounded border p-2">
                  <p>
                    Row {index + 1} · {row.asset}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Channels: {row.channels.join(', ') || 'every connected account'}
                  </p>
                  <Textarea
                    aria-label={`Caption for import row ${index + 1}`}
                    disabled={busy || !!row.id || !!row.request}
                    value={row.caption}
                    onChange={(event) => {
                      const next = rows.map((item) =>
                        item === row ? { ...item, caption: event.target.value } : item
                      )
                      try {
                        persist(next)
                        setRows(next)
                      } catch {
                        toast.error(
                          'Could not save import progress. Free browser storage before editing this batch.'
                        )
                      }
                    }}
                    className="w-full bg-background"
                  />
                  {row.id ? (
                    <a href={`/write/${row.id}`} className="underline">
                      Draft created
                    </a>
                  ) : (
                    <span>{row.error ?? problem(row) ?? 'Ready to import'}</span>
                  )}
                  {row.definitiveFailure && !row.id ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        const next = rows.map((item) =>
                          item === row
                            ? {
                                ...item,
                                key: crypto.randomUUID(),
                                request: undefined,
                                error: undefined,
                                definitiveFailure: false,
                              }
                            : item
                        )
                        try {
                          persist(next)
                          setRows(next)
                        } catch {
                          toast.error('Could not save import progress. Keep this tab open.')
                        }
                      }}
                    >
                      Edit rejected row
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
            <Button
              disabled={busy || rows.every((row) => !!row.id || !!problem(row))}
              onClick={() => void create()}
            >
              {busy ? 'Importing…' : 'Create remaining drafts'}
            </Button>
            <Button
              disabled={busy || !rows.some((row) => row.id)}
              onClick={() => setScheduling(true)}
            >
              Review scheduling
            </Button>
          </>
        )}
        {rows.length > 0 ? (
          <>
            <Button
              variant="outline"
              disabled={
                busy || rows.some((row) => row.request && !row.id && !row.definitiveFailure)
              }
              onClick={() => {
                if (rows.some((row) => !row.id) && !confirmReset) {
                  setConfirmReset(true)
                  return
                }
                try {
                  sessionStorage.removeItem(storageKey)
                  setRows([])
                  setCSV('caption,asset,channels\n')
                  setFiles([])
                  setRestored(false)
                  setConfirmReset(false)
                } catch {
                  toast.error('Could not clear this batch’s browser receipt. Keep this tab open.')
                }
              }}
            >
              {confirmReset ? 'Discard unfinished rows and start again' : 'Start a new batch'}
            </Button>
            {confirmReset && (
              <p>
                Created drafts and uploaded assets stay in the workspace. Unfinished rows will be
                removed from this import.
              </p>
            )}
            {rows.some((row) => row.request && !row.id && !row.definitiveFailure) && (
              <p>
                Retry unfinished requests before starting another batch. Their outcome is
                unconfirmed; retrying the saved request prevents duplicate drafts.
              </p>
            )}
          </>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  )
}
