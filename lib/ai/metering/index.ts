import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { workspaceQuotaSchema } from '@/lib/billing/plans'
import { consumeWorkspaceQuota } from '@/lib/tenant/entitlements'
import { createAiCreditMeter } from './meter'

/**
 * The server's AI credit meter, charging `ai:credits:monthly` through the Go
 * backend. The model registry charges every call to `aiCreditMeter`; AI
 * actions run inside `withAiCredits`.
 */
const credits = createAiCreditMeter<TenantContext>((tenant, amount) =>
  consumeWorkspaceQuota(tenant, workspaceQuotaSchema.enum['ai:credits:monthly'], amount)
)

/** Charges each model call to the workspace whose AI action is running. */
export const aiCreditMeter = credits.meter

/** Runs an AI action against the workspace's AI credits. */
export const withAiCredits = credits.withAiCredits
