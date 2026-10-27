'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { storeProviderSchema, type AscBrowseResult, type CredentialSummary, type StoreProvider } from '@/lib/api/contracts/store-publishing'
import { evaluateSlide } from '@/lib/store-screenshots/engine/scene'
import { slugify } from '@/lib/store-screenshots/export/plan'
import { localeName, playLocale } from '@/lib/store-screenshots/locales'
import { getStoreTarget, sizeLabel, STORE_TARGETS, targetPixelSize } from '@/lib/store-screenshots/targets'
import { cn } from '@/lib/utils'
import { encodeCanvas, renderSceneToCanvas } from '../../render/capture'
import { useRenderServices } from '../../render/RenderProvider'
import { useEditor } from '../editor-store'
import type { DialogProps } from './BasicDialogs'
import { blobToBase64, requestJson } from './request'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * Send screenshots to App Store Connect or a Google Play edit. Uploads go
 * through the server with credentials it decrypts per request; the browser
 * never sees a key. App Store uploads never submit a version for review,
 * and a Google Play edit changes the live listing only when the user
 * commits it with an explicit confirmation.
 */

const PROVIDERS = storeProviderSchema.options

const PROVIDER_LABEL = { APP_STORE_CONNECT: 'App Store Connect', GOOGLE_PLAY: 'Google Play' } as const satisfies Record<StoreProvider, string>

/** The upload plan: one entry per file, in upload order. */
type UploadItem = { targetId: string; locale: string; slideIndex: number; first: boolean }

function uploadPlan(targetIds: string[], locales: string[], slideIndexes: number[]): UploadItem[] {
  return targetIds.flatMap((targetId) =>
    locales.flatMap((locale) => slideIndexes.map((slideIndex, order) => ({ targetId, locale, slideIndex, first: order === 0 })))
  )
}

/** The publish dialog. */
export function PublishDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const document = useEditor((state) => state.document)
  const { measurer, resolveAsset, whenAssetsReady } = useRenderServices()
  const [provider, setProvider] = React.useState<StoreProvider>('APP_STORE_CONNECT')
  const [credentials, setCredentials] = React.useState<CredentialSummary[] | null>(null)
  const [configured, setConfigured] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [credentialId, setCredentialId] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)

  const [apps, setApps] = React.useState<NonNullable<AscBrowseResult['apps']>>([])
  const [appId, setAppId] = React.useState('')
  const [versions, setVersions] = React.useState<NonNullable<AscBrowseResult['versions']>>([])
  const [versionId, setVersionId] = React.useState('')
  const [localizations, setLocalizations] = React.useState<NonNullable<AscBrowseResult['localizations']>>([])
  const [packageName, setPackageName] = React.useState('')
  const [browsing, setBrowsing] = React.useState(false)

  const allLocales = [document.localization.sourceLocale, ...document.localization.locales]
  const [locales, setLocales] = React.useState<string[]>([document.localization.sourceLocale])
  const [targetIds, setTargetIds] = React.useState<string[]>([])
  const [replace, setReplace] = React.useState(true)
  const [progress, setProgress] = React.useState<{ done: number; total: number; label: string } | null>(null)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [commitConfirmed, setCommitConfirmed] = React.useState(false)
  /** Every planned file reached the edit; committing a partial upload would publish an incomplete set. */
  const [uploadedAll, setUploadedAll] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)

  const providerCredentials = (credentials ?? []).filter((item) => item.provider === provider)
  const providerTargets = STORE_TARGETS.filter((target) => (provider === 'APP_STORE_CONNECT' ? target.ascDisplayType : target.playImageType))
  const slideIndexes = document.slides.map((_, index) => index)

  const loadCredentials = React.useCallback(async () => {
    try {
      const result = await requestJson<{ credentials: CredentialSummary[]; configured: boolean }>('/api/store-screenshots/publishing/credentials')
      setCredentials(result.credentials)
      setConfigured(result.configured)
      setLoadError(null)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Store connections could not be loaded.')
    }
  }, [])

  React.useEffect(() => {
    if (open) void loadCredentials()
  }, [open, loadCredentials])

  const switchProvider = (next: StoreProvider) => {
    setProvider(next)
    setCredentialId('')
    setTargetIds([])
    setEditId(null)
    setCommitConfirmed(false)
  }

  const browse = async (input: { appId?: string; versionId?: string }) => {
    setBrowsing(true)
    try {
      const result = await requestJson<AscBrowseResult>('/api/store-screenshots/publishing/app-store/browse', { body: { credentialId, ...input } })
      if (result.apps) setApps(result.apps)
      if (result.versions) setVersions(result.versions)
      if (result.localizations) setLocalizations(result.localizations)
    } catch (cause) {
      toast.error('App Store Connect did not answer', { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      setBrowsing(false)
    }
  }

  const chooseCredential = (id: string) => {
    setCredentialId(id)
    setApps([])
    setAppId('')
    setVersions([])
    setVersionId('')
    setLocalizations([])
    setEditId(null)
  }

  const removeCredential = async (id: string) => {
    try {
      await requestJson(`/api/store-screenshots/publishing/credentials/${id}`, { method: 'DELETE' })
      setConfirmDelete(null)
      if (credentialId === id) chooseCredential('')
      await loadCredentials()
    } catch (cause) {
      toast.error('The connection could not be removed', { description: cause instanceof Error ? cause.message : undefined })
    }
  }

  const localizationFor = (locale: string) => localizations.find((item) => item.locale === locale)
  const plan = uploadPlan(targetIds, locales, slideIndexes)
  const tooMany = targetIds.map((id) => getStoreTarget(id)!).filter((target) => slideIndexes.length > target.maxCount)
  const missingLocales = provider === 'APP_STORE_CONNECT' && localizations.length ? locales.filter((locale) => !localizationFor(locale)) : []
  const ready =
    Boolean(credentialId) &&
    plan.length > 0 &&
    tooMany.length === 0 &&
    (provider === 'APP_STORE_CONNECT' ? Boolean(versionId) && localizations.length > 0 && missingLocales.length === 0 : /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(packageName))

  const render = async (item: UploadItem, signal: AbortSignal) => {
    const target = getStoreTarget(item.targetId)!
    const size = targetPixelSize(target, 0, target.orientations[0])
    const scene = evaluateSlide(document, item.slideIndex, { size, targetId: target.id, locale: item.locale, measurer })
    const canvas = await renderSceneToCanvas(scene, resolveAsset, { signal })
    const png = await encodeCanvas(canvas, 'png', 1)
    const blob = target.maxFileBytes && png.size > target.maxFileBytes ? await encodeCanvas(canvas, 'jpeg', 0.92) : png
    const slide = document.slides[item.slideIndex]
    const extension = blob.type === 'image/png' ? 'png' : 'jpg'
    return { image: await blobToBase64(blob), fileName: `${String(item.slideIndex + 1).padStart(2, '0')}_${slugify(slide.name || 'slide')}_${size.width}x${size.height}.${extension}`.slice(0, 120) }
  }

  const upload = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setCommitConfirmed(false)
    setUploadedAll(false)
    let done = 0
    setProgress({ done, total: plan.length, label: 'Preparing…' })
    try {
      await whenAssetsReady(Object.keys(document.assets))
      let currentEdit = editId
      if (provider === 'GOOGLE_PLAY' && !currentEdit) {
        currentEdit = (await requestJson<{ editId: string }>('/api/store-screenshots/publishing/google-play', { body: { action: 'start', credentialId, packageName }, signal: controller.signal })).editId
        setEditId(currentEdit)
      }
      for (const item of plan) {
        const target = getStoreTarget(item.targetId)!
        setProgress({ done, total: plan.length, label: `${target.shortName} · ${localeName(item.locale)} · slide ${item.slideIndex + 1}` })
        const file = await render(item, controller.signal)
        if (provider === 'APP_STORE_CONNECT') {
          await requestJson('/api/store-screenshots/publishing/app-store/upload', {
            body: { credentialId, localizationId: localizationFor(item.locale)!.id, displayType: target.ascDisplayType, clearFirst: replace && item.first, ...file },
            signal: controller.signal,
          })
        } else {
          await requestJson('/api/store-screenshots/publishing/google-play', {
            body: { action: 'upload', credentialId, packageName, editId: currentEdit, language: playLocale(item.locale), imageType: target.playImageType, clearFirst: replace && item.first, ...file },
            signal: controller.signal,
          })
        }
        done += 1
        setProgress({ done, total: plan.length, label: '' })
      }
      setUploadedAll(true)
      toast.success(
        provider === 'APP_STORE_CONNECT'
          ? `Uploaded ${done} screenshots. Nothing was submitted for review.`
          : `Uploaded ${done} screenshots to a draft edit. Commit it to update the listing.`
      )
    } catch (cause) {
      if (controller.signal.aborted) toast(`Upload stopped after ${done} of ${plan.length} files.`)
      else toast.error(`Upload stopped after ${done} of ${plan.length} files`, { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const commit = async () => {
    try {
      await requestJson('/api/store-screenshots/publishing/google-play', { body: { action: 'commit', credentialId, packageName, editId, confirmed: true } })
      setEditId(null)
      setCommitConfirmed(false)
      toast.success('Edit committed. Google Play is updating the listing.')
    } catch (cause) {
      toast.error('The edit could not be committed', { description: cause instanceof Error ? cause.message : undefined })
    }
  }

  const running = progress !== null

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[92vh] sm:max-w-3xl overflow-y-auto" onEscapeKeyDown={(event) => running && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Upload to the stores</DialogTitle>
          <DialogDescription>Screenshots are rendered at each store size and sent from the server. Your keys stay encrypted on the server and never reach the browser.</DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Store" className="flex gap-1 rounded-md bg-foreground/[0.05] p-1">
          {PROVIDERS.map((item) => (
            <Button variant="custom" size={null} key={item} role="tab" type="button" aria-selected={provider === item} disabled={running} onClick={() => switchProvider(item)} className={cn('flex-1 rounded px-3 py-1.5 text-xs', provider === item ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>
              {PROVIDER_LABEL[item]}
            </Button>
          ))}
        </div>

        {!configured ? (
          <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            Store uploads are not set up on this server yet. An administrator needs to set STORE_PUBLISHING_ENCRYPTION_KEY before keys can be saved.
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="text-xs text-destructive">
            {loadError}
          </p>
        ) : null}

        <section aria-labelledby="publish-connection" className="space-y-2">
          <h3 id="publish-connection" className="text-xs font-semibold">
            Connection
          </h3>
          {providerCredentials.length === 0 && credentials !== null ? <p className="text-xs text-muted-foreground">No {PROVIDER_LABEL[provider]} connection yet.</p> : null}
          <div className="space-y-1.5">
            {providerCredentials.map((item) => (
              <div key={item.id} className={cn('flex items-center gap-2 rounded-md border p-2 text-xs', credentialId === item.id ? 'border-foreground/40' : 'border-foreground/10')}>
                <Label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <Input type="radio" name="publish-credential" disabled={running} checked={credentialId === item.id} onChange={() => chooseCredential(item.id)} />
                  <span className="truncate">
                    <span className="font-medium">{item.label}</span>{' '}
                    <span className="text-muted-foreground">· {item.metadata.keyId ? `Key ${item.metadata.keyId}` : item.metadata.clientEmail}</span>
                  </span>
                </Label>
                {confirmDelete === item.id ? (
                  <>
                    <Button variant="destructive" size="sm" onClick={() => void removeCredential(item.id)}>
                      Remove
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" disabled={running} onClick={() => setConfirmDelete(item.id)}>
                    Remove…
                  </Button>
                )}
              </div>
            ))}
          </div>
          {adding ? (
            <AddCredentialForm
              provider={provider}
              onCancel={() => setAdding(false)}
              onAdded={(credential) => {
                setAdding(false)
                setCredentials((current) => [...(current ?? []), credential])
                chooseCredential(credential.id)
              }}
            />
          ) : (
            <Button variant="outline" size="sm" disabled={!configured || running} onClick={() => setAdding(true)}>
              Add {PROVIDER_LABEL[provider]} connection
            </Button>
          )}
        </section>

        {credentialId ? (
          <section aria-labelledby="publish-destination" className="space-y-2">
            <h3 id="publish-destination" className="text-xs font-semibold">
              Destination
            </h3>
            {provider === 'APP_STORE_CONNECT' ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {apps.length === 0 ? (
                  <Button variant="outline" size="sm" disabled={browsing || running} onClick={() => void browse({})}>
                    {browsing ? 'Loading…' : 'Load apps'}
                  </Button>
                ) : (
                  <Select
                    value={String(appId) || '__empty_option__'}
                    disabled={running}
                    onValueChange={(nextValue) => {
                      setAppId(nextValue === '__empty_option__' ? '' : nextValue)
                      setVersionId('')
                      setVersions([])
                      setLocalizations([])
                      if (nextValue === '__empty_option__' ? '' : nextValue)
                        void browse({ appId: nextValue === '__empty_option__' ? '' : nextValue })
                    }}
                  >
                    <SelectTrigger
                      aria-label="App"
                      className="h-8 rounded-md border border-foreground/15 bg-background px-2 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={'__empty_option__'}>Choose an app</SelectItem>
                      {apps.map((app) => (
                        <SelectItem key={app.id} value={app.id}>
                          {app.name} ({app.bundleId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {appId ? (
                  <Select
                    value={String(versionId) || '__empty_option__'}
                    disabled={running || browsing}
                    onValueChange={(nextValue) => {
                      setVersionId(nextValue === '__empty_option__' ? '' : nextValue)
                      setLocalizations([])
                      if (nextValue === '__empty_option__' ? '' : nextValue)
                        void browse({
                          versionId: nextValue === '__empty_option__' ? '' : nextValue,
                        })
                    }}
                  >
                    <SelectTrigger
                      aria-label="Version"
                      className="h-8 rounded-md border border-foreground/15 bg-background px-2 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={'__empty_option__'}>Choose a version</SelectItem>
                      {versions.map((version) => (
                        <SelectItem
                          key={version.id}
                          value={version.id}
                          disabled={!version.editable}
                        >
                          {version.versionString} · {version.platform} ·{' '}
                          {version.appStoreState.replaceAll('_', ' ').toLowerCase()}
                          {version.editable ? '' : ' (locked)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {versionId ? <p className="self-center text-[11px] text-muted-foreground">{localizations.length ? `${localizations.length} languages on this version` : browsing ? 'Loading languages…' : ''}</p> : null}
              </div>
            ) : (
              <Label className="block text-xs">
                <span className="text-muted-foreground">Package name</span>
                <Input value={packageName} disabled={running || Boolean(editId)} onChange={(event) => setPackageName(event.target.value.trim())} placeholder="com.example.app" className="mt-1 h-8 w-full rounded-md border border-foreground/15 bg-background px-2 font-mono text-xs" />
              </Label>
            )}
          </section>
        ) : null}

        {credentialId ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset disabled={running} className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold">Sizes</legend>
              {providerTargets.map((target) => (
                <Label key={target.id} className="flex items-center gap-2 text-xs">
                  <Checkbox  checked={targetIds.includes(target.id)} onCheckedChange={(checked) => setTargetIds((checked === true) ? [...targetIds, target.id] : targetIds.filter((id) => id !== target.id))} />
                  <span>
                    {target.shortName} <span className="text-muted-foreground">· {sizeLabel(targetPixelSize(target, 0, target.orientations[0]))}</span>
                  </span>
                </Label>
              ))}
            </fieldset>
            <fieldset disabled={running} className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold">Languages</legend>
              {allLocales.map((code) => (
                <Label key={code} className="flex items-center gap-2 text-xs">
                  <Checkbox  checked={locales.includes(code)} onCheckedChange={(checked) => setLocales((checked === true) ? [...locales, code] : locales.filter((item) => item !== code))} />
                  {localeName(code)}
                  {provider === 'GOOGLE_PLAY' ? <span className="text-muted-foreground">({playLocale(code)})</span> : null}
                  {provider === 'APP_STORE_CONNECT' && localizations.length && !localizationFor(code) ? <span className="text-destructive">not on this version</span> : null}
                </Label>
              ))}
              <Label className="mt-2 flex items-start gap-2 text-xs">
                <Checkbox  checked={replace} onCheckedChange={(checked) => setReplace((checked === true))} className="mt-0.5" />
                <span>
                  Replace the screenshots already there
                  <span className="block text-[10px] text-muted-foreground">Otherwise new screenshots are added after the existing ones, up to the store limit.</span>
                </span>
              </Label>
            </fieldset>
          </div>
        ) : null}

        {tooMany.length ? (
          <p role="alert" className="text-xs text-destructive">
            {tooMany.map((target) => `${target.shortName} accepts at most ${target.maxCount} screenshots per language`).join('; ')}; this project has {slideIndexes.length} slides.
          </p>
        ) : null}
        {missingLocales.length ? (
          <p role="alert" className="text-xs text-destructive">
            Add {missingLocales.map(localeName).join(', ')} to the version in App Store Connect first, or leave those languages out.
          </p>
        ) : null}

        {progress ? (
          <div className="space-y-1.5" role="status">
            <div className="flex justify-between text-xs">
              <span className="truncate">{progress.label || 'Uploading…'}</span>
              <span className="tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            <progress className="h-1.5 w-full" max={progress.total} value={progress.done} aria-label="Upload progress" />
          </div>
        ) : null}

        {provider === 'GOOGLE_PLAY' && editId && uploadedAll && !running ? (
          <section aria-labelledby="publish-commit" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            <h3 id="publish-commit" className="font-semibold">
              Draft edit ready
            </h3>
            <p>The uploaded images sit in a draft edit and are not on the store listing yet. Committing applies the whole edit to your live listing.</p>
            <Label className="flex items-start gap-2">
              <Checkbox  checked={commitConfirmed} onCheckedChange={(checked) => setCommitConfirmed((checked === true))} className="mt-0.5" />I understand this changes the live Google Play listing for {packageName}.
            </Label>
            <Button disabled={!commitConfirmed} onClick={() => void commit()}>
              Commit edit to Google Play
            </Button>
          </section>
        ) : null}

        {provider === 'GOOGLE_PLAY' && editId && !uploadedAll && !running ? (
          <p role="status" className="text-xs">
            The last upload did not finish, so this draft edit cannot be committed. Upload again to complete it, or{' '}
            <Button variant="custom" size={null} type="button" className="underline underline-offset-2" onClick={() => setEditId(null)}>
              start a new draft
            </Button>
            . Uncommitted drafts never reach the listing.
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {plan.length} files · {provider === 'APP_STORE_CONNECT' ? 'nothing is submitted for review' : 'nothing goes live until you commit'}
          </p>
          <div className="flex gap-2">
            {running ? (
              <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                Stop upload
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button disabled={!ready} onClick={() => void upload()}>
                  Upload {plan.length} {plan.length === 1 ? 'file' : 'files'}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddCredentialForm({ provider, onCancel, onAdded }: { provider: StoreProvider; onCancel: () => void; onAdded: (credential: CredentialSummary) => void }) {
  const [label, setLabel] = React.useState('')
  const [issuerId, setIssuerId] = React.useState('')
  const [keyId, setKeyId] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [fileName, setFileName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const asc = provider === 'APP_STORE_CONNECT'

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const credential = await requestJson<CredentialSummary>('/api/store-screenshots/publishing/credentials', {
        body: { provider, label, secret, ...(asc ? { issuerId: issuerId.trim(), keyId: keyId.trim() } : {}) },
      })
      setSecret('')
      onAdded(credential)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The connection could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-md border border-foreground/15 p-3 text-xs">
      <Label className="block">
        <span className="text-muted-foreground">Name</span>
        <Input required value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder={asc ? 'e.g. Team upload key' : 'e.g. Play publisher'} className="mt-1 h-8 w-full rounded-md border border-foreground/15 bg-background px-2" />
      </Label>
      {asc ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Label className="block">
            <span className="text-muted-foreground">Issuer ID</span>
            <Input required value={issuerId} onChange={(event) => setIssuerId(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-foreground/15 bg-background px-2 font-mono" />
          </Label>
          <Label className="block">
            <span className="text-muted-foreground">Key ID</span>
            <Input required value={keyId} onChange={(event) => setKeyId(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-foreground/15 bg-background px-2 font-mono" />
          </Label>
        </div>
      ) : null}
      <Label className="block">
        <span className="text-muted-foreground">{asc ? 'Private key (.p8) with the App Manager role' : 'Service account key (.json) with release permissions'}</span>
        <Input
          type="file"
          required
          accept={asc ? '.p8' : '.json,application/json'}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            setFileName(file?.name ?? '')
            setSecret(file && file.size < 12_000 ? await file.text() : '')
            if (file && file.size >= 12_000) setError('That file is too large to be a key.')
          }}
          className="mt-1 block w-full text-xs"
        />
      </Label>
      <p className="text-[10px] text-muted-foreground">
        {fileName ? `${fileName} is read in your browser and sent once over HTTPS; the server checks it and stores it encrypted.` : 'The key is stored encrypted on the server and is never shown again.'}
      </p>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || !secret || !label.trim()}>
          {saving ? 'Checking…' : 'Save connection'}
        </Button>
      </div>
    </form>
  )
}
