'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { uploadDesignSources, withUploadedSources } from '@/lib/design/upload-sources'
import { applySetCommand, type SetCommand } from './commands'
import { newCreativeSetId, creativeSetDocumentSchema, type CreativeSetDocument } from './document'
import { mergeSetConcurrent } from './concurrent'
import { removeSetRecovery, writeSetRecovery } from './recovery'
import { trackEvent } from '@/lib/analytics'
import { uploadStoreGroupAssets } from './store-assets'
import { resolveStoreGroupUploads } from './store-schema'
import {
  RevisionedSession,
  type RevisionedRecord,
  type RevisionedSessionState,
  type RevisionedStorage,
} from './revisioned-session'

export type SetRecord = RevisionedRecord<CreativeSetDocument>
export type SetSessionState = RevisionedSessionState<CreativeSetDocument>

/** One owner for set transactions, undo and serialized cloud saves. */
export class CreativeSetSession extends RevisionedSession<CreativeSetDocument> {
  private copyId = newCreativeSetId()
  constructor(
    record: SetRecord,
    client: TRPCClient<AppRouter>,
    storage: RevisionedStorage<CreativeSetDocument> = {
      write: writeSetRecovery,
      remove: removeSetRecovery,
    }
  ) {
    const storeUploads = new Map<string, string>()
    super(record, client, storage, {
      label: 'story_set',
      parse: (document) => creativeSetDocumentSchema.parse(document),
      merge: mergeSetConcurrent,
      upload: async (document) => {
        for (const output of document.outputs)
          output.document = await uploadDesignSources(client, output.document)
        document.storeGroups = await Promise.all(
          document.storeGroups.map((group) => uploadStoreGroupAssets(client, group, storeUploads))
        )
        return document
      },
      resolveUploads: (original, uploaded, snapshot) => {
        const current = structuredClone(original)
        for (const output of current.outputs) output.document = withUploadedSources(output.document)
        current.storeGroups = current.storeGroups.map((group) =>
          resolveStoreGroupUploads(
            group,
            uploaded.storeGroups.find((candidate) => candidate.id === group.id),
            snapshot.storeGroups.find((candidate) => candidate.id === group.id)
          )
        )
        return current
      },
      get: () => client.creativeSet.get.query({ creativeSetId: record.id }),
      update: (baseRevision, document) =>
        client.creativeSet.updateDocument.mutate({
          creativeSetId: record.id,
          baseRevision,
          document,
        }),
    })
    trackEvent('story_set_open', {
      stories: record.document.stories.length,
      outputs: record.document.outputs.length,
      revision: record.revision,
    })
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
  async preserveCopy() {
    const document = await this.kind.upload(structuredClone(this.history.document))
    return this.client.creativeSet.create.mutate({
      id: this.copyId,
      document,
      name: `${this.record.name.slice(0, 180)} recovered copy`,
    })
  }
}
