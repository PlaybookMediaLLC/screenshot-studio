import { z } from 'zod'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'
import { permissions } from '@/lib/auth/permissions'
import { workspaceFeatureSchema, workspaceQuotaSchema } from '@/lib/billing/plans'

/** A role permission such as `audit:read`, validated against `lib/auth/permissions`. */
export const permissionSchema = z.enum(permissions)

/** An organization API-key product scope, validated against `lib/auth/api-key-scopes`. */
export const apiKeyScopeSchema = z.enum(apiKeyScopes)

/**
 * What a tenant operation requires: a session member with `permission`, or
 * an organization API key with `apiKeyScope`, then the optional plan feature
 * and metered quota.
 */
export const tenantAccessRequirementSchema = z.object({
  apiKeyScope: apiKeyScopeSchema,
  feature: workspaceFeatureSchema.optional(),
  permission: permissionSchema,
  quota: workspaceQuotaSchema.optional(),
})

/** One of {@link tenantAccessRequirementSchema}. */
export type TenantAccessRequirement = z.infer<typeof tenantAccessRequirementSchema>

/**
 * Which organization a permission check runs against. `active` is the
 * session's active organization. `requested` is the `organizationId` in the
 * path, query, or body, which must also be the active organization.
 */
export const organizationScopeSchema = z.enum(['active', 'requested'])

/** One of {@link organizationScopeSchema}. */
export type OrganizationScope = z.infer<typeof organizationScopeSchema>

/** Options for an organization permission check. */
export const organizationAccessOptionsSchema = z.object({
  scope: organizationScopeSchema.default('active'),
  /** Also require a sign-in under 15 minutes old with two-factor enabled. */
  sensitive: z.boolean().default(false),
})

/** Caller-facing form of {@link organizationAccessOptionsSchema}; every field is optional. */
export type OrganizationAccessOptions = z.input<typeof organizationAccessOptionsSchema>

/** The `organizationId` a `requested`-scope route names in its path, query, or body. */
export const requestedOrganizationSchema = z.object({ organizationId: z.string().min(1).max(128) })

/** One of {@link requestedOrganizationSchema}. */
export type RequestedOrganization = z.infer<typeof requestedOrganizationSchema>
