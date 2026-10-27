'use client'

import type { TRPCClient } from '@trpc/client'
import { create } from 'zustand'
import { exportDesignDocument } from '@/lib/design/export'
import { applyStoredDocument } from '@/lib/design/open-design'
import { rememberUploadedSources, withUploadedSources } from '@/lib/design/upload-sources'
import { useImageStore } from '@/lib/store'
import type { AppRouter } from '@/lib/trpc/router'
import { applyBrandKit, type BrandCategory } from './apply'
import {
  type BrandKit,
  brandKitDefinition,
  type BrandKitDraft,
  brandKitLibrary,
  storedBrandKitSchema,
} from './kit'

type Client = TRPCClient<AppRouter>

/** The workspace's brand kits, shared by the editor and batch mode. */
export type BrandKitLibraryState = {
  /** Owners and admins manage kits; everyone applies them. */
  canManage: boolean
  error: string | null
  kits: BrandKit[]
  loading: boolean
}

/** The brand kit library, loaded with {@link loadBrandKits}. */
export const useBrandKits = create<BrandKitLibraryState>(() => ({
  canManage: false,
  error: null,
  kits: [],
  loading: false,
}))

/** Load (or reload) the workspace's brand kits. */
export async function loadBrandKits(trpcClient: Client): Promise<BrandKit[]> {
  useBrandKits.setState({ error: null, loading: true })
  try {
    const { brandKits, canManage } = await trpcClient.brandKit.list.query()
    const kits = brandKitLibrary(brandKits.map((kit) => storedBrandKitSchema.parse(kit)))
    useBrandKits.setState({ canManage, kits, loading: false })
    return kits
  } catch (error) {
    useBrandKits.setState({
      error: error instanceof Error ? error.message : 'The brand kits could not be loaded.',
      loading: false,
    })
    throw error
  }
}

/**
 * Save a kit: a new kit, or the next version of `previous`. A changed name
 * renames the kit first, so its history follows it.
 */
export async function saveBrandKit(
  trpcClient: Client,
  name: string,
  input: BrandKitDraft,
  previous?: BrandKit
) {
  const taken = useBrandKits
    .getState()
    .kits.some((kit) => kit.name === name && kit.id !== previous?.id)
  if (taken) throw new Error(`A brand kit named “${name}” exists. Pick another name.`)
  if (previous && previous.name !== name)
    await trpcClient.brandKit.rename.mutate({ id: previous.id, name })
  const { brandKit } = await trpcClient.brandKit.create.mutate({
    definition: brandKitDefinition(input),
    name,
    publish: true,
  })
  await loadBrandKits(trpcClient)
  return brandKit
}

/** Delete a kit. Its versions are archived; designs that used it keep their values. */
export async function deleteBrandKit(trpcClient: Client, kit: BrandKit) {
  await trpcClient.brandKit.archive.mutate({ id: kit.id })
  await loadBrandKits(trpcClient)
}

/**
 * Apply a kit to the editor's design as one undoable step. Properties the
 * user changed since the design's kit set them are kept unless `resetOverrides`;
 * their paths are returned.
 */
export async function applyBrandKitToEditor(
  trpcClient: Client,
  kit: BrandKit,
  categories: readonly BrandCategory[],
  { resetOverrides = false }: { resetOverrides?: boolean } = {}
): Promise<string[]> {
  // Workspace images the editor loaded compare by asset id, as the kit stored them.
  const current = withUploadedSources(exportDesignDocument({ keepLocalSources: true }))
  // The values the previous kit (this one or another) set tell the user's overrides apart.
  const result = applyBrandKit(current, kit, categories, {
    binding: useImageStore.getState().brand,
    resetOverrides,
  })
  rememberUploadedSources(
    await applyStoredDocument(trpcClient, { ...result.document, brand: result.binding }, 'step')
  )
  return result.keptOverrides
}
