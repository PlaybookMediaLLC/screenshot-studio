'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { trackEvent } from '@/lib/analytics'
import { DocumentHistory } from './history'
import { ConcurrentEditError } from './concurrent'
import type { DocumentRecovery } from './recovery'

/** A stored creative document: a Story Set or a canvas workspace. */
export type RevisionedRecord<D> = {
  id: string
  organizationId: string
  name: string
  revision: number
  document: D
}

/** Where the open document's autosave is, and what the UI may offer. */
export type RevisionedSessionState<D> = {
  document: D
  revision: number
  status: 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'error'
  error: string | null
  recoveryError: string | null
  /** Bumped when the open native canvas must reload from the document. */
  loadEpoch: number
  canUndo: boolean
  canRedo: boolean
}

/** Local recovery storage, replaceable in tests. */
export type RevisionedStorage<D> = {
  write: (record: DocumentRecovery<D>) => Promise<void>
  remove: (key: string) => Promise<void>
}

/** How one kind of creative document is validated, merged, uploaded and stored. */
export type RevisionedKind<D> = {
  /** Analytics prefix: counts and enum values only, never content. */
  label: string
  parse: (document: D) => D
  merge: (base: D, local: D, remote: D) => D
  /** A copy whose local images are uploaded workspace assets. */
  upload: (document: D) => Promise<D>
  /** `current` with references `upload` produced, without replacing edits made since `snapshot`. */
  resolveUploads: (current: D, uploaded: D, snapshot: D) => D
  get: () => Promise<{ revision: number; document: D }>
  update: (baseRevision: number, document: D) => Promise<{ revision: number }>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const conflictCode = (error: unknown) => (error as { data?: { code?: string } })?.data?.code

/**
 * One owner for document transactions, undo, local recovery and serialized
 * cloud saves. Every write names the revision it was based on; a stale write
 * merges independent fields and stops on overlapping ones.
 */
export class RevisionedSession<D> {
  readonly history: DocumentHistory<D>
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving: Promise<boolean> | null = null
  private refreshing = false
  private editFailure: string | null = null
  private recovery: Promise<void> = Promise.resolve()
  private recoveredKeys = new Set<string>()
  private disposed = false
  private saved: D
  private state: RevisionedSessionState<D>
  readonly recoveryKey: string
  readonly tabId = crypto.randomUUID()
  constructor(
    readonly record: RevisionedRecord<D>,
    readonly client: TRPCClient<AppRouter>,
    private storage: RevisionedStorage<D>,
    protected readonly kind: RevisionedKind<D>
  ) {
    this.history = new DocumentHistory(record.document, kind.merge)
    this.saved = record.document
    this.recoveryKey = `${record.organizationId}:${record.id}:${this.tabId}`
    this.state = {
      document: record.document,
      revision: record.revision,
      status: 'saved',
      error: null,
      recoveryError: null,
      loadEpoch: 0,
      canUndo: false,
      canRedo: false,
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.state
  private emit(patch: Partial<RevisionedSessionState<D>>) {
    this.state = {
      ...this.state,
      ...patch,
      document: this.history.document,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    }
    for (const listener of this.listeners) listener()
  }
  /** Record a validated document as one undo step; `loadCanvas` reloads the open native canvas. */
  commit(document: D, loadCanvas = true) {
    if (this.history.commit(this.kind.parse(document))) this.changed(loadCanvas)
  }
  undo() {
    try {
      this.history.undo()
      this.changed(true)
    } catch (error) {
      this.emit({
        error: error instanceof Error ? error.message : 'Undo conflicts with a later edit.',
      })
    }
  }
  redo() {
    try {
      this.history.redo()
      this.changed(true)
    } catch (error) {
      this.emit({
        error: error instanceof Error ? error.message : 'Redo conflicts with a later edit.',
      })
    }
  }
  private changed(loadCanvas: boolean) {
    this.emit({
      loadEpoch: this.state.loadEpoch + Number(loadCanvas),
      status: this.state.status === 'conflict' ? 'conflict' : 'unsaved',
    })
    this.persistRecovery()
    clearTimeout(this.timer)
    if (!this.disposed)
      this.timer = setTimeout(() => {
        void this.save()
      }, 1500)
  }
  private persistRecovery() {
    const record: DocumentRecovery<D> = {
      key: this.recoveryKey,
      workspaceId: this.record.organizationId,
      setId: this.record.id,
      tabId: this.tabId,
      revision: this.state.revision,
      updatedAt: Date.now(),
      document: this.history.document,
    }
    this.recovery = this.recovery
      .catch(() => undefined)
      .then(() => this.storage.write(record))
      .then(
        () => {
          this.emit({ recoveryError: null })
        },
        () => {
          this.emit({
            recoveryError:
              'Local recovery could not be saved. Keep this tab open until cloud saving succeeds.',
          })
        }
      )
  }
  /** Open a draft this device kept; a draft based on an older revision opens as a conflict. */
  recover(record: DocumentRecovery<D>) {
    if (record.workspaceId !== this.record.organizationId || record.setId !== this.record.id)
      throw new Error('This recovery draft belongs to another document or workspace.')
    this.history.commit(record.document)
    this.recoveredKeys.add(record.key)
    if (record.revision !== this.state.revision)
      this.emit({
        status: 'conflict',
        error:
          'The saved document changed after this recovery draft. Keep your work as a copy or load the saved version.',
      })
    this.changed(true)
  }
  /** Replace local work with a saved record, after the person chose to. */
  acceptSaved(record: { revision: number; document: D }) {
    this.history.commit(record.document)
    this.saved = record.document
    clearTimeout(this.timer)
    this.emit({
      revision: record.revision,
      status: 'saved',
      error: null,
      loadEpoch: this.state.loadEpoch + 1,
    })
    this.clearSavedRecovery()
  }
  private clearSavedRecovery() {
    // Serialize deletion with draft writes so a newly typed edit cannot be erased by a save.
    this.recovery = this.recovery
      .then(async () => {
        if (!same(this.history.document, this.saved)) return
        for (const key of [this.recoveryKey, ...this.recoveredKeys]) await this.storage.remove(key)
        this.recoveredKeys.clear()
      })
      .catch(() => undefined)
  }
  /** An invalid native edit blocks saving until it is corrected. */
  editorFailure(message: string | null) {
    const previous = this.editFailure
    this.editFailure = message
    if (message) this.emit({ status: 'error', error: message })
    else if (previous)
      this.emit({
        status: same(this.history.document, this.saved) ? 'saved' : 'unsaved',
        error: null,
      })
  }
  /** Save now. Resolves false when the document could not be stored. */
  async save(): Promise<boolean> {
    if (this.editFailure) return false
    clearTimeout(this.timer)
    if (this.state.status === 'conflict') return false
    if (this.saving) {
      await this.saving
      return this.snapshot().status === 'conflict' ? false : this.save()
    }
    if (same(this.history.document, this.saved)) {
      this.emit({ status: 'saved' })
      return true
    }
    this.saving = this.saveNow()
    try {
      return await this.saving
    } finally {
      this.saving = null
    }
  }
  private async saveNow(): Promise<boolean> {
    const snapshot = this.history.document
    this.emit({ status: 'saving', error: null })
    try {
      const uploaded: D = await this.kind.upload(structuredClone(snapshot))
      let result: { revision: number } | undefined
      let baseline = this.saved
      let baseRevision = this.state.revision
      let sent: D = uploaded
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          result = await this.kind.update(baseRevision, sent)
          break
        } catch (error) {
          if (conflictCode(error) !== 'CONFLICT') throw error
          const remote = await this.kind.get()
          if (same(remote.document, sent)) {
            result = remote
            break
          }
          sent = this.kind.merge(baseline, sent, remote.document)
          baseline = remote.document
          baseRevision = remote.revision
          if (attempt === 3) throw new ConcurrentEditError('revision; several editors are saving')
        }
      }
      if (!result) throw new Error('Saving did not complete.')
      this.saved = sent
      // Upload completion can overlap another edit. Resolve URLs without replacing that edit.
      this.history.normalizeAssets((original) =>
        this.kind.resolveUploads(original, uploaded, snapshot)
      )
      const current = this.history.document
      const merged = this.kind.merge(uploaded, current, sent)
      this.history.document = merged
      const clean = same(merged, sent)
      this.emit({
        revision: result.revision,
        status: clean ? 'saved' : 'unsaved',
        loadEpoch: this.state.loadEpoch + Number(!same(merged, current)),
      })
      await this.recovery
      if (same(this.history.document, this.saved)) {
        this.clearSavedRecovery()
        await this.recovery
      } else {
        this.persistRecovery()
        if (!this.disposed)
          this.timer = setTimeout(() => {
            void this.save()
          }, 1500)
      }
      return clean
    } catch (error) {
      const code = conflictCode(error)
      trackEvent(`${this.kind.label}_save_failed`, {
        reason:
          error instanceof ConcurrentEditError || code === 'CONFLICT'
            ? 'conflict'
            : code
              ? 'rejected'
              : 'offline',
      })
      this.emit({
        status:
          error instanceof ConcurrentEditError || code === 'CONFLICT'
            ? 'conflict'
            : code
              ? 'error'
              : 'offline',
        error: error instanceof Error ? error.message : 'Saving failed.',
      })
      this.persistRecovery()
      if (!code && !(error instanceof ConcurrentEditError) && !this.disposed)
        this.timer = setTimeout(() => {
          void this.save()
        }, 5000)
      return false
    }
  }
  /** Polling is also the reconnect path; Go revisions remain the only durable writer. */
  async refreshRemote(beforeApply: () => void = () => undefined) {
    if (this.disposed || this.saving || this.refreshing || this.state.status === 'conflict') return
    this.refreshing = true
    try {
      const remote = await this.kind.get()
      if (this.disposed || this.saving || remote.revision <= this.state.revision) return
      beforeApply()
      const merged = this.kind.merge(this.saved, this.history.document, remote.document)
      this.saved = remote.document
      this.history.document = merged
      this.emit({
        revision: remote.revision,
        status: same(merged, remote.document) ? 'saved' : 'unsaved',
        error: null,
        loadEpoch: this.state.loadEpoch + 1,
      })
      if (same(merged, this.saved)) this.clearSavedRecovery()
      else this.changed(false)
    } catch (error) {
      if (error instanceof ConcurrentEditError) {
        this.emit({ status: 'conflict', error: error.message })
        this.persistRecovery()
      }
      // Network failures leave local edits and the existing autosave retry intact.
    } finally {
      this.refreshing = false
    }
  }
  /** Stop timers and listeners; pending local recovery stays on the device. */
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.listeners.clear()
  }
}
