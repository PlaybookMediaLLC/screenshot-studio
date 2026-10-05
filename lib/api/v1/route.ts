import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import type { ApiKeyScope } from '@/lib/auth/api-key-scopes'
import type { Permission } from '@/lib/auth/permissions'
import type { WorkspaceFeature, WorkspaceQuota } from '@/lib/billing/plans'
import { AuthorizationError, type TenantContext } from '@/lib/auth/access'
import { apiError, type ApiErrorCode } from '@/lib/api/errors'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireTenantAccess } from '@/lib/tenant/access'

export type RestRouteContext<Params extends Record<string, string> = Record<string, string>> = {
  params: Promise<Params>
}

type TenantAccessRequirement = {
  apiKeyScope: ApiKeyScope
  feature?: WorkspaceFeature
  permission: Permission
  quota?: WorkspaceQuota
}

type TenantJsonRouteDefinition<Input, Output, Params extends Record<string, string>> = {
  access: TenantAccessRequirement
  schema: ZodType<Input>
  input: (request: NextRequest, context: RestRouteContext<Params>) => unknown | Promise<unknown>
  execute: (tenant: TenantContext, input: Input, request: NextRequest) => Output | Promise<Output>
  respond?: (output: Output) => NextResponse
}

const ERROR_DETAILS = {
  400: {
    code: 'invalid_request',
    hint: 'Check the request body, query parameters, and path values against the OpenAPI schema.',
  },
  401: {
    code: 'unauthorized',
    hint: 'Send a valid X-API-Key header or sign in to an authorized workspace session.',
  },
  403: {
    code: 'forbidden',
    hint: 'Use credentials with the required workspace permission, API-key scope, and plan access.',
  },
  404: { code: 'not_found', hint: 'Check the resource identifier and workspace context.' },
  429: { code: 'rate_limited', hint: 'Wait for the indicated reset time, then retry.' },
  503: { code: 'upstream_unavailable', hint: 'Retry later with exponential backoff.' },
} as const

async function getPublicRouteErrorResponse(error: unknown): Promise<NextResponse> {
  const response = getRouteErrorResponse(error)
  const body = (await response.json()) as Record<string, unknown>
  const details = ERROR_DETAILS[response.status as keyof typeof ERROR_DETAILS] ?? {
    code: 'internal_error' as const,
    hint: 'Retry the request. If it keeps failing, contact support.',
  }
  const message =
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error === 'string' && body.error) ||
    'Request failed.'
  const code = (typeof body.code === 'string' ? body.code : details.code) as ApiErrorCode
  const hint = typeof body.hint === 'string' ? body.hint : details.hint
  const extra = Object.fromEntries(
    Object.entries(body).filter(
      ([key]) => !['code', 'documentation', 'error', 'hint', 'message', 'status'].includes(key)
    )
  )
  const headers = Object.fromEntries(response.headers.entries())

  return apiError(response.status, code, message, hint, extra, headers)
}

export function createTenantJsonRoute<
  Input,
  Output,
  Params extends Record<string, string> = Record<string, string>,
>(definition: TenantJsonRouteDefinition<Input, Output, Params>) {
  return async function tenantJsonRoute(
    request: NextRequest,
    routeContext: RestRouteContext<Params>
  ): Promise<NextResponse> {
    try {
      const tenant = await requireTenantAccess(request.headers, definition.access)
      const untrustedInput = await definition.input(request, routeContext)
      const input = await definition.schema.parseAsync(untrustedInput)
      const output = await definition.execute(tenant, input, request)
      return definition.respond?.(output) ?? NextResponse.json(output)
    } catch (error) {
      return getPublicRouteErrorResponse(error)
    }
  }
}

const shellClients = new Set(['cli', 'openwhispr', 'wanta', 'web'])

/**
 * The calling shell, for metrics only. The header is client-supplied, so it
 * never reaches an authorization decision.
 */
export function getShellClient(headers: Headers): string {
  const client = headers.get('x-playbook-client')?.trim().toLowerCase() ?? ''
  return shellClients.has(client) ? client : 'unknown'
}

type ShellJsonRouteDefinition<Output, Params extends Record<string, string>> = {
  /** Stable metric name, such as `bootstrap` or `organizations.activate`. */
  name: string
  execute: (request: NextRequest, params: Params) => Promise<Output>
}

/**
 * A human-shell endpoint under /api/v1. These describe a signed-in user and
 * their organizations, so an organization API key is refused rather than
 * silently treated as a session. Responses are per-user and never cached by
 * intermediaries.
 */
export function createShellJsonRoute<
  Output,
  Params extends Record<string, string> = Record<string, string>,
>(definition: ShellJsonRouteDefinition<Output, Params>) {
  return async function shellJsonRoute(
    request: NextRequest,
    routeContext: RestRouteContext<Params>
  ): Promise<NextResponse> {
    const startedAt = performance.now()
    let response: NextResponse
    try {
      if (request.headers.has('x-api-key')) {
        throw new AuthorizationError(
          'Shell endpoints require a signed-in user session, not an API key.',
          403
        )
      }
      const output = await definition.execute(request, await routeContext.params)
      response = NextResponse.json(output)
    } catch (error) {
      response = await getPublicRouteErrorResponse(error)
    }
    response.headers.set('cache-control', 'private, no-store')
    // One structured line per shell request: latency, denials (401/403), and
    // active-org switches are counted from these in the log pipeline.
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        client: getShellClient(request.headers),
        durationMs: Math.round(performance.now() - startedAt),
        event: 'playbook.shell_request',
        route: definition.name,
        status: response.status,
      })
    )
    return response
  }
}
