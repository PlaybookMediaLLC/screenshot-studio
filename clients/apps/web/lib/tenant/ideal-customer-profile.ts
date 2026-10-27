import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, withDates } from '@/lib/backend/sdk'
import type { IdealCustomerProfileUpsertInput } from './ideal-customer-profile-schema'

/** The workspace's ideal customer profile, or null before one is saved. */
export async function getIdealCustomerProfile(context: TenantContext) {
  const { idealCustomerProfile } = await backendSDK(context).getIdealCustomerProfile()
  return idealCustomerProfile && withDates(idealCustomerProfile)
}

/** A saved ideal customer profile, with its dates parsed. */
export type StoredIdealCustomerProfile = NonNullable<
  Awaited<ReturnType<typeof getIdealCustomerProfile>>
>

/** A person's change to the ICP; owner or admin only. Each changed field is locked. */
export async function upsertIdealCustomerProfile(
  context: TenantContext,
  input: IdealCustomerProfileUpsertInput
) {
  return withDates(
    await backendSDK(context).upsertIdealCustomerProfile({ ...input, source: 'manual' })
  )
}
