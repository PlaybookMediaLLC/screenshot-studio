'use client'

import type { TRPCClient } from '@trpc/client'
import { create } from 'zustand'
import type { DesignDocument } from '@/lib/design/document'
import { exportDesignDocument } from '@/lib/design/export'
import { applyStoredDocument } from '@/lib/design/open-design'
import { uploadDesignSources } from '@/lib/design/upload-sources'
import type { AppRouter } from '@/lib/trpc/router'
import {
  applyPresetTo,
  copyName,
  creativeTemplateSchema,
  type DesignPreset,
  presetDefinition,
  presetLibrary,
} from './preset'

type Client = TRPCClient<AppRouter>

/** The workspace's saved presets, shared by the editor and batch mode. */
export type PresetLibraryState = {
  error: string | null
  loading: boolean
  presets: DesignPreset[]
}

/** The preset library, loaded with {@link loadPresets}. */
export const usePresetLibrary = create<PresetLibraryState>(() => ({
  error: null,
  loading: false,
  presets: [],
}))

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The presets could not be loaded.'
}

/** Load (or reload) the workspace's presets. */
export async function loadPresets(trpcClient: Client): Promise<DesignPreset[]> {
  usePresetLibrary.setState({ error: null, loading: true })
  try {
    const { templates } = await trpcClient.creativeTemplate.list.query()
    const presets = presetLibrary(
      templates.map((template) => creativeTemplateSchema.parse(template))
    )
    usePresetLibrary.setState({ loading: false, presets })
    return presets
  } catch (error) {
    usePresetLibrary.setState({ error: message(error), loading: false })
    throw error
  }
}

async function store(trpcClient: Client, name: string, document: DesignDocument) {
  const uploaded = await uploadDesignSources(trpcClient, document)
  const { template } = await trpcClient.creativeTemplate.create.mutate({
    definition: presetDefinition(uploaded),
    name,
  })
  await loadPresets(trpcClient)
  return template
}

/** Save the editor's design as a new preset, uploading its local images (logos, backgrounds) once. */
export async function savePresetFromEditor(trpcClient: Client, name: string) {
  if (usePresetLibrary.getState().presets.some((preset) => preset.name === name)) {
    throw new Error(`A preset named “${name}” exists. Pick another name, or update that preset.`)
  }
  return store(trpcClient, name, exportDesignDocument({ keepLocalSources: true }))
}

/** Replace a preset with the editor's design, as its next version. */
export function updatePresetFromEditor(trpcClient: Client, preset: DesignPreset) {
  return store(trpcClient, preset.name, exportDesignDocument({ keepLocalSources: true }))
}

/** Save a copy of a preset under a free name. */
export function duplicatePreset(trpcClient: Client, preset: DesignPreset) {
  const taken = new Set(usePresetLibrary.getState().presets.map((entry) => entry.name))
  return store(trpcClient, copyName(preset.name, taken), preset.document)
}

/** Rename a preset (every version). */
export async function renamePreset(trpcClient: Client, preset: DesignPreset, name: string) {
  await trpcClient.creativeTemplate.rename.mutate({ id: preset.id, name })
  await loadPresets(trpcClient)
}

/** Delete a preset. Its versions are archived, so designs made from it are unaffected. */
export async function deletePreset(trpcClient: Client, preset: DesignPreset) {
  await trpcClient.creativeTemplate.archive.mutate({ id: preset.id })
  await loadPresets(trpcClient)
}

/** Apply a preset to the editor's screenshot as one undoable step. */
export async function applyPreset(trpcClient: Client, preset: DesignPreset) {
  const current = exportDesignDocument({ keepLocalSources: true })
  await applyStoredDocument(trpcClient, applyPresetTo(preset.document, current), 'step')
}
