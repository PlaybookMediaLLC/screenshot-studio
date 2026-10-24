import 'server-only'

import {
  getIdealCustomerProfile,
  upsertIdealCustomerProfile,
} from '@/lib/tenant/ideal-customer-profile'
import { idealCustomerProfileUpsertSchema } from '@/lib/tenant/ideal-customer-profile-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** The workspace's ideal customer profile (docs/rfcs/034-background-onboarding-agent.md). */
export const idealCustomerProfileRouter = router({
  get: organizationProcedure('workspace:read').query(async ({ ctx }) => ({
    idealCustomerProfile: await getIdealCustomerProfile(ctx.access),
  })),
  /** A person's edit: each changed field is locked against automated updates. */
  upsert: organizationProcedure('brand:manage')
    .input(idealCustomerProfileUpsertSchema)
    .mutation(async ({ ctx, input }) => ({
      idealCustomerProfile: await upsertIdealCustomerProfile(ctx.access, input),
    })),
})
