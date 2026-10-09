/**
 * Model-level middleware composed around every model the registry hands out.
 *
 * Distinct from `tools/tool-middleware.ts`, which runs around *tool execution*.
 * This layer sits between the SDK and the provider, so it sees every generation
 * regardless of which transport or tool triggered it.
 */

import type { LanguageModelMiddleware } from 'ai'
import type { ModelRole } from '../catalog'
import { createLoggingMiddleware, type ModelLogger } from './logging'
import { createSettingsMiddleware } from './settings'
import { createUsageMiddleware, type UsageObserver } from './usage'

export { type Clock, createLoggingMiddleware, type ModelLogger } from './logging'
export { createSettingsMiddleware, MAX_OUTPUT_TOKENS } from './settings'
export {
  createUsageMiddleware,
  normalizeTokenUsage,
  type TokenUsage,
  type UsageEvent,
  type UsageObserver,
} from './usage'

/**
 * Optional hooks the registry can attach to every model it builds.
 */
export type ModelMiddlewareOptions = {
  /** Invoked once per completed non-streaming call with normalized usage. */
  onUsage?: UsageObserver
  /** Logger for per-call structured lines. Defaults to structured stdout. */
  logger?: ModelLogger
}

/**
 * Builds the middleware stack for one role.
 *
 * Order matters. Settings run first so later middleware observes the
 * parameters actually sent. Usage runs before logging so a throwing observer
 * cannot suppress the log line for a call that did happen.
 *
 * @param role - the role the model was resolved from.
 * @param modelId - the provider model id, for attribution.
 * @param options - optional usage observer and logger.
 * @returns the ordered middleware list to pass to `wrapLanguageModel`.
 */
export function createModelMiddleware(
  role: ModelRole,
  modelId: string,
  options: ModelMiddlewareOptions = {}
): LanguageModelMiddleware[] {
  const middleware: LanguageModelMiddleware[] = [createSettingsMiddleware(role)]

  if (options.onUsage) {
    middleware.push(createUsageMiddleware(role, modelId, options.onUsage))
  }

  middleware.push(createLoggingMiddleware(role, modelId, options.logger))

  return middleware
}
