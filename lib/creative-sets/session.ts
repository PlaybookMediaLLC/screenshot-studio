'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { uploadDesignSources, withUploadedSources } from '@/lib/design/upload-sources'
import { applySetCommand, type SetCommand } from './commands'
import { newCreativeSetId, creativeSetDocumentSchema, type CreativeSetDocument } from './document'
import { SetHistory } from './history'
import { ConcurrentEditError, mergeSetConcurrent } from './concurrent'
import { removeSetRecovery, writeSetRecovery, type SetRecovery } from './recovery'
import { trackEvent } from '@/lib/analytics'
import { uploadStoreGroupAssets } from './store-assets'

export type SetRecord = {
  id: string
  organizationId: string
  name: string
  revision: number
  document: CreativeSetDocument
}
export type SetSessionState = {
  document: CreativeSetDocument
  revision: number
  status: 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'error'
  error: string | null
  recoveryError: string | null
  loadEpoch: number
  canUndo: boolean
  canRedo: boolean
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One owner for set transactions, undo and serialized cloud saves. */
export class CreativeSetSession {
  readonly history: SetHistory
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving: Promise<boolean> | null = null
  private refreshing = false
  private storeUploads = new Map<string, string>()
  private editFailure: string | null = null
  private recovery: Promise<void> = Promise.resolve()
  private recoveredKeys = new Set<string>()
  private disposed = false
  private saved: CreativeSetDocument
  private state: SetSessionState
  readonly recoveryKey: string
  readonly tabId = crypto.randomUUID()
  private copyId = newCreativeSetId()
  constructor(
    readonly record: SetRecord,
    readonly client: TRPCClient<AppRouter>,
    private storage = { write: writeSetRecovery, remove: removeSetRecovery }
  ) {
    trackEvent('story_set_open', {
      stories: record.document.stories.length,
      outputs: record.document.outputs.length,
      revision: record.revision,
    })
    this.history = new SetHistory(record.document)
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
  private emit(patch: Partial<SetSessionState>) {
    this.state = {
      ...this.state,
      ...patch,
      document: this.history.document,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    }
    for (const listener of this.listeners) listener()
  }
  command(command: SetCommand) {
    this.commit(applySetCommand(this.history.document, command))
    trackEvent('story_set_command', {
      command: command.type,
      stories: this.history.document.stories.length,
      outputs: this.history.document.outputs.length,
      local_copy: this.history.document.outputs.filter(
        (output) => output.overrides.headline || output.overrides.supporting
      ).length,
    })
  }
  commit(document: CreativeSetDocument, loadCanvas = true) {
    if (this.history.commit(creativeSetDocumentSchema.parse(document))) this.changed(loadCanvas)
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
    const record: SetRecovery = {
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
  recover(record: SetRecovery) {
    if (record.workspaceId !== this.record.organizationId || record.setId !== this.record.id)
      throw new Error('This recovery draft belongs to another set or workspace.')
    this.history.commit(record.document)
    this.recoveredKeys.add(record.key)
    if (record.revision !== this.state.revision)
      this.emit({
        status: 'conflict',
        error:
          'The saved set changed after this recovery draft. Keep your work as a copy or load the saved version.',
      })
    this.changed(true)
  }
  acceptSaved(record: SetRecord) {
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
    const document = structuredClone(snapshot)
    this.emit({ status: 'saving', error: null })
    try {
      for (const output of document.outputs)
        output.document = await uploadDesignSources(this.client, output.document)
      document.storeGroups = await Promise.all(
        document.storeGroups.map((group) =>
          uploadStoreGroupAssets(this.client, group, this.storeUploads)
        )
      )
      let result: { revision: number } | undefined
      let baseline = this.saved
      let baseRevision = this.state.revision
      let sent = document
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          result = await this.client.creativeSet.updateDocument.mutate({
            creativeSetId: this.record.id,
            baseRevision,
            document: sent,
          })
          break
        } catch (error) {
          if ((error as { data?: { code?: string } })?.data?.code !== 'CONFLICT') throw error
          const remote = await this.client.creativeSet.get.query({ creativeSetId: this.record.id })
          if (same(remote.document, sent)) {
            result = remote
            break
          }
          sent = mergeSetConcurrent(baseline, sent, remote.document)
          baseline = remote.document
          baseRevision = remote.revision
          if (attempt === 3) throw new ConcurrentEditError('revision; several editors are saving')
        }
      }
      if (!result) throw new Error('Saving did not complete.')
      this.saved = sent
      // Upload completion can overlap another edit. Resolve URLs without replacing that edit.
      this.history.normalizeAssets((original) => {
        const current = structuredClone(original)
        for (const output of current.outputs) output.document = withUploadedSources(output.document)
        for (const group of current.storeGroups) {
          const uploaded = document.storeGroups.find((candidate) => candidate.id === group.id)
          for (const [id, ref] of Object.entries(uploaded?.assetMap ?? {})) {
            const previous = snapshot.storeGroups.find((candidate) => candidate.id === group.id)
              ?.document.assets[id]
            if (!group.assetMap[id] && previous && same(group.document.assets[id], previous))
              group.assetMap[id] = ref
            if (group.assetMap[id] && group.document.assets[id])
              group.document.assets[id]!.src = null
          }
        }
        return current
      })
      const current = this.history.document
      const merged = mergeSetConcurrent(document, current, sent)
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
      const code = (error as { data?: { code?: string } })?.data?.code
      trackEvent('story_set_save_failed', {
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
      const remote = await this.client.creativeSet.get.query({ creativeSetId: this.record.id })
      if (this.disposed || this.saving || remote.revision <= this.state.revision) return
      beforeApply()
      const merged = mergeSetConcurrent(this.saved, this.history.document, remote.document)
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
  async preserveCopy() {
    const document = structuredClone(this.history.document)
    for (const output of document.outputs)
      output.document = await uploadDesignSources(this.client, output.document)
    document.storeGroups = await Promise.all(
      document.storeGroups.map((group) =>
        uploadStoreGroupAssets(this.client, group, this.storeUploads)
      )
    )
    return this.client.creativeSet.create.mutate({
      id: this.copyId,
      document,
      name: `${this.record.name.slice(0, 180)} recovered copy`,
    })
  }
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.listeners.clear()
  }
}
