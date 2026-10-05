/**
 * Structured logging for model calls.
 *
 * Answers "which role, which model, how long, how many tokens, did it fail" for
 * every generation without a per-call-site log line. Prompt and completion text
 * are deliberately never logged — they carry customer product and release
 * data, and the log pipeline is not an appropriate place for it.
 */

import type { LanguageModelMiddleware } from 'ai'
import type { ModelRole } from '../catalog'
import { normalizeTokenUsage } from './usage'

/**
 * The logger this middleware needs, injected so tests can observe emissions
 * without a real logger.
 */
export type ModelLogger = {
  debug: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

/** One JSON line per call, matching the platform's structured log shape. */
const stdoutLogger: ModelLogger = {
  debug: (event, fields) => {
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ event, ...(fields as object) }))
  },
  error: (event, fields) => {
    console.error(JSON.stringify({ event, ...(fields as object) }))
  },
}

/**
 * Reads a monotonic-ish timestamp.
 *
 * Injected so duration assertions in tests are deterministic.
 */
export type Clock = () => number

/**
 * Summarizes a failure for logging without echoing provider text.
 *
 * Provider error messages routinely embed fragments of the request or response
 * body — a moderation or schema rejection quotes the offending input back. That
 * input is customer data, so the free-text message is deliberately
 * NOT logged. The error class and HTTP status are what an operator alerts on;
 * full detail belongs in the trace, which is a separate, access-controlled sink.
 *
 * @param error - the thrown value.
 * @returns log-safe fields describing the failure.
 */
function describeFailure(error: unknown): {
  errorName: string
  statusCode?: number
} {
  const name = error instanceof Error ? error.constructor.name : typeof error
  const status = (error as { statusCode?: unknown } | undefined)?.statusCode

  return typeof status === 'number' ? { errorName: name, statusCode: status } : { errorName: name }
}

/**
 * Builds middleware that logs one line per completed or failed generate call.
 *
 * Failures are re-thrown after logging — this observes, it does not handle.
 *
 * @param role - the role this model was resolved from.
 * @param modelId - the provider model id, for attribution.
 * @param log - logger to emit through; defaults to structured stdout.
 * @param now - clock used for duration; defaults to `Date.now`.
 * @returns middleware wrapping the generate operation.
 */
export function createLoggingMiddleware(
  role: ModelRole,
  modelId: string,
  log: ModelLogger = stdoutLogger,
  now: Clock = Date.now
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      const startedAt = now()
      try {
        const result = await doGenerate()
        const usage = normalizeTokenUsage(result.usage)
        log.debug('ai.model.generate', {
          role,
          modelId,
          durationMs: now() - startedAt,
          finishReason: result.finishReason,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })
        return result
      } catch (error) {
        log.error('ai.model.generate.failed', {
          role,
          modelId,
          durationMs: now() - startedAt,
          ...describeFailure(error),
        })
        throw error
      }
    },
  }
}
