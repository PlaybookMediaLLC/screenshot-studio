import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Principal } from '@/lib/auth/principal'
import {
  BackendSDKError,
  ScreenshotStudioBackendSDK,
  type BackendScope,
} from 'screenshot-studio-backend-sdk'

type BackendContext = { organizationId: string; principal: Principal; requestId: string }

/** The principal half of a backend scope, per principal kind. */
type PrincipalScope = BackendScope extends infer Scope
  ? Scope extends unknown
    ? Omit<Scope, 'organizationId' | 'requestId'>
    : never
  : never

function principalScope(principal: Principal): PrincipalScope {
  switch (principal.kind) {
    case 'session':
      return {
        display: principal.display,
        kind: 'session',
        sessionId: principal.sessionId,
        userId: principal.userId,
      }
    case 'organization_api_key':
      return { display: principal.display, keyId: principal.keyId, kind: 'api_key' }
    case 'support':
      return { grantId: principal.grantId, kind: 'support', userId: principal.userId }
    case 'webhook':
      return { display: principal.connectionId, kind: 'webhook' }
    case 'trigger_service':
      return { display: principal.taskRunId, kind: 'service' }
  }
}

function client(scope: BackendScope): ScreenshotStudioBackendSDK {
  return new ScreenshotStudioBackendSDK(
    process.env.PUBLISHING_API_URL ?? '',
    process.env.PUBLISHING_SERVICE_TOKEN ?? '',
    scope
  )
}

/** The backend client acting for this principal in its workspace. */
export function backendSDK(context: BackendContext): ScreenshotStudioBackendSDK {
  return client({
    organizationId: context.organizationId,
    requestId: context.requestId,
    ...principalScope(context.principal),
  } as BackendScope)
}

/**
 * The backend client for the web facade itself: the Better Auth adapter and
 * effects of auth changes, which run before or outside any tenant principal.
 */
export function serviceBackend(): ScreenshotStudioBackendSDK {
  return client({ display: 'web', kind: 'service', organizationId: '', requestId: randomUUID() })
}

/** A backend 404 is a missing tenant row, which the readers return as null. */
export async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 404) return null
    throw error
  }
}

type WithDates<T> = T extends string
  ? T
  : T extends (infer Item)[]
    ? WithDates<Item>[]
    : T extends object
      ? {
          [Key in keyof T]: Key extends `${string}At`
            ? Exclude<T[Key], string> | Date
            : WithDates<T[Key]>
        }
      : T

/** Backend JSON carries ISO timestamps; the web readers return `*At` fields as Dates. */
export function withDates<T>(value: T): WithDates<T> {
  if (Array.isArray(value)) return value.map(withDates) as WithDates<T>
  if (!value || typeof value !== 'object') return value as WithDates<T>
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key.endsWith('At') && typeof item === 'string' ? new Date(item) : withDates(item),
    ])
  ) as WithDates<T>
}
