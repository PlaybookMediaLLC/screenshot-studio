import 'server-only'

import type { OrganizationAccess, TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import type {
  BrandKitCreateInput,
  BrandProfileUpsertInput,
  SourceAppCreateInput,
  SourceAppUpdateInput,
} from './schemas'

export async function listBrandKits(context: OrganizationAccess) {
  const result = await backendSDK(context).listBrandKits()
  return result.brandKits.map(({ createdAt, definition, id, name, status, version }) => ({
    createdAt: new Date(createdAt),
    definition,
    id,
    name,
    status,
    version,
  }))
}

export async function createBrandKit(context: OrganizationAccess, input: BrandKitCreateInput) {
  const kit = await backendSDK(context).createBrandKit(input)
  return { ...kit, createdAt: new Date(kit.createdAt), updatedAt: new Date(kit.updatedAt) }
}

export async function getBrandProfile(context: OrganizationAccess) {
  const { brandProfile } = await backendSDK(context).getBrandProfile()
  return (
    brandProfile && {
      ...brandProfile,
      createdAt: new Date(brandProfile.createdAt),
      updatedAt: new Date(brandProfile.updatedAt),
    }
  )
}

export async function upsertBrandProfile(
  context: OrganizationAccess,
  input: BrandProfileUpsertInput
) {
  const profile = await backendSDK(context).upsertBrandProfile(input)
  return {
    ...profile,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
  }
}

export async function createSourceApp(context: TenantContext, input: SourceAppCreateInput) {
  const sourceApp = await backendSDK(context).createSourceApp(input)
  return {
    ...sourceApp,
    createdAt: new Date(sourceApp.createdAt),
    updatedAt: new Date(sourceApp.updatedAt),
  }
}

/** Changes the rules that decide which of a source's deliveries become releases. */
export async function updateSourceApp(
  context: TenantContext,
  sourceAppId: string,
  input: SourceAppUpdateInput
) {
  const sourceApp = await backendSDK(context).updateSourceApp(sourceAppId, input)
  return {
    ...sourceApp,
    createdAt: new Date(sourceApp.createdAt),
    updatedAt: new Date(sourceApp.updatedAt),
  }
}
