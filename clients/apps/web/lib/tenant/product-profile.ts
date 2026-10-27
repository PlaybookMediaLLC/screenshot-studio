import 'server-only'

import type { ProductProfileField } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, withDates } from '@/lib/backend/sdk'
import type { ProductProfileSource, ProductProfileUpsertInput } from './product-profile-schema'

/** The workspace's product profile, or null before one is saved. */
export async function getProductProfile(context: TenantContext) {
  const { productProfile } = await backendSDK(context).getProductProfile()
  return productProfile && withDates(productProfile)
}

/** A saved product profile, with its dates parsed. */
export type StoredProductProfile = NonNullable<Awaited<ReturnType<typeof getProductProfile>>>

/**
 * Create or change the product profile; owner or admin only. A manual change
 * locks each field it changes. An automated one skips locked fields and
 * records `sourceUrls`, the page each value came from.
 */
export async function upsertProductProfile(
  context: TenantContext,
  input: ProductProfileUpsertInput & {
    source: ProductProfileSource
    sourceUrls?: Partial<Record<ProductProfileField, string>>
  }
) {
  return withDates(await backendSDK(context).upsertProductProfile(input))
}
