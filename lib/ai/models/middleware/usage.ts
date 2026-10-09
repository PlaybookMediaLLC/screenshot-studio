/** Token-usage observation for every model call. */

import type { LanguageModelMiddleware } from 'ai'
import type { ModelRole } from '../catalog'
import {
  errorOutcome,
  tapStreamUsage,
  type TerminalObservation,
  usageFromError,
} from './usage-stream'

/**
 * Normalized token counts for one model call.
 *
 * Providers report usage under names that have shifted across SDK majors
 * (`promptTokens`/`completionTokens` in v4, `inputTokens`/`outputTokens` in
 * v5+). This is the stable projection callers meter against.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Terminal outcome for one provider model call. */
export type UsageOutcome = 'finish' | 'abort' | 'error' | 'cancel'

/**
 * A single observed model call.
 */
export interface UsageEvent {
  role: ModelRole
  modelId: string
  operation: 'generate' | 'stream'
  usage: TokenUsage
  /** Optional to keep old event literals source-compatible. */
  outcome?: UsageOutcome
  finishReason?: string
}

/**
 * Receives one {@link UsageEvent} per completed model call.
 */
export type UsageObserver = (event: UsageEvent) => void

/** Normalizes provider usage across SDK versions and clamps invalid counts. */
export function normalizeTokenUsage(usage: unknown): TokenUsage {
  const record = (usage ?? {}) as Record<string, unknown>

  const inputTokens = readCount(record.inputTokens ?? record.promptTokens)
  const outputTokens = readCount(record.outputTokens ?? record.completionTokens)
  const totalTokens = readCount(record.totalTokens) || inputTokens + outputTokens

  return { inputTokens, outputTokens, totalTokens }
}

/** Reads a flat SDK count or a provider-level `{ total }` bucket. */
function readCount(value: unknown): number {
  if (typeof value === 'number') {
    return value > 0 && Number.isFinite(value) ? value : 0
  }

  if (value && typeof value === 'object') {
    const total = (value as { total?: unknown }).total
    return typeof total === 'number' && total > 0 && Number.isFinite(total) ? total : 0
  }

  return 0
}

/**
 * Reports an observation without letting it break the caller.
 *
 * Metering must never be able to fail a user-facing generation, so a throwing
 * observer is swallowed here rather than propagating.
 */
function reportSafely(observe: UsageObserver, event: UsageEvent): void {
  try {
    observe(event)
  } catch {
    // Observation is best-effort by design; see above.
  }
}

const finishReason = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const reason = value as { raw?: unknown; unified?: unknown }
  return typeof reason.unified === 'string'
    ? reason.unified
    : typeof reason.raw === 'string'
      ? reason.raw
      : undefined
}

const createTerminalReporter = (options: {
  role: ModelRole
  modelId: string
  operation: UsageEvent['operation']
  observe: UsageObserver
}) => {
  let reported = false
  return (terminal: TerminalObservation): void => {
    if (reported) {
      return
    }
    reported = true
    const reason = finishReason(terminal.finishReason)
    reportSafely(options.observe, {
      role: options.role,
      modelId: options.modelId,
      operation: options.operation,
      outcome: terminal.outcome,
      usage: normalizeTokenUsage(terminal.usage),
      ...(reason ? { finishReason: reason } : {}),
    })
  }
}

/** Builds middleware that reports one terminal observation per model call. */
export function createUsageMiddleware(
  role: ModelRole,
  modelId: string,
  observe: UsageObserver
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      const report = createTerminalReporter({ role, modelId, operation: 'generate', observe })
      try {
        const result = await doGenerate()
        report({ outcome: 'finish', usage: result.usage, finishReason: result.finishReason })
        return result
      } catch (error) {
        report({ outcome: errorOutcome(error), usage: usageFromError(error) })
        throw error
      }
    },
    wrapStream: async ({ doStream }) => {
      const report = createTerminalReporter({ role, modelId, operation: 'stream', observe })
      try {
        const result = await doStream()
        const stream = tapStreamUsage(
          result.stream as unknown as Parameters<typeof tapStreamUsage>[0],
          report
        )
        return { ...result, stream: stream as unknown as typeof result.stream }
      } catch (error) {
        report({ outcome: errorOutcome(error), usage: usageFromError(error) })
        throw error
      }
    },
  }
}
