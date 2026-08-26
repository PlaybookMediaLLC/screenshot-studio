import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { AuthorizationError } from '@/lib/auth/access'
import {
  TenantStorageObjectMissingError,
  TenantStorageUnavailableError,
} from '@/lib/storage/client'
import { InvalidTenantObjectKeyError } from '@/lib/tenant/object-key'
import { ScheduledPostError } from '@/lib/tenant/scheduled-posts'
import { CampaignError } from '@/lib/tenant/campaigns'
import { CreativeWorkflowError } from '@/lib/tenant/creative'
import { WorkspaceError } from '@/lib/workspace/errors'
import { WorkspaceEntitlementError } from '@/lib/tenant/entitlements'

function isDatabaseUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1001') ||
    (typeof error === 'object' &&
      error !== null &&
      'body' in error &&
      typeof error.body === 'object' &&
      error.body !== null &&
      'code' in error.body &&
      error.body.code === 'FAILED_TO_GET_SESSION')
  )
}

function getWorkflowErrorResponse(error: unknown): NextResponse | null {
  if (
    error instanceof ScheduledPostError ||
    error instanceof CreativeWorkflowError ||
    error instanceof CampaignError ||
    error instanceof WorkspaceError
  ) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  return null
}

function getEntitlementErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof WorkspaceEntitlementError)) return null

  const documentation = 'https://www.screenshot-studio.com/api-reference'

  return NextResponse.json(
    {
      code: 'workspace_feature_not_entitled',
      currentPlan: error.currentPlan,
      documentation,
      error: error.message,
      feature: error.feature,
      hint: `Upgrade to ${error.requiredPlan} or ask a workspace owner to review the contract entitlement.`,
      message: error.message,
      requiredPlan: error.requiredPlan,
      status: error.status,
    },
    {
      headers: {
        'x-current-plan': error.currentPlan,
        'x-required-plan': error.requiredPlan,
      },
      status: error.status,
    }
  )
}

export function getRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  const entitlementResponse = getEntitlementErrorResponse(error)
  if (entitlementResponse) return entitlementResponse
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (error instanceof InvalidTenantObjectKeyError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof TenantStorageUnavailableError || isDatabaseUnavailable(error)) {
    return NextResponse.json({ error: 'A required dependency is unavailable.' }, { status: 503 })
  }
  if (error instanceof TenantStorageObjectMissingError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const workflowResponse = getWorkflowErrorResponse(error)
  if (workflowResponse) {
    return workflowResponse
  }

  console.error('Route request failed.', error)
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
}
