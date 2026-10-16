/** Charges every model call to the AI credit meter. */

import type { LanguageModelMiddleware } from 'ai'
import { callCostUsd } from '@/lib/ai/metering/pricing'
import { toOpenRouterModelId } from '../provider'
import { tapStreamUsage } from './usage-stream'

/**
 * The meter a model charges. The registry injects the server's credit meter;
 * tests inject a fake.
 */
export type ModelCallMeter = {
  /**
   * Admits one call, or rejects when it must not start: no metered action, or
   * no credits left. Resolves to the function that records what the call cost
   * in US dollars, which never throws.
   */
  admit(): Promise<(costUsd: number) => Promise<void>>
}

/**
 * Builds middleware that admits each call through the meter and records what
 * it cost. A refused call never reaches the provider; a finished call is
 * always recorded, even when it is the one that crosses the limit.
 */
export function createMeterMiddleware(
  modelId: string,
  meter: ModelCallMeter
): LanguageModelMiddleware {
  const priceId = toOpenRouterModelId(modelId)
  return {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      const record = await meter.admit()
      const result = await doGenerate()
      await record(callCostUsd(priceId, result.usage, result.providerMetadata))
      return result
    },
    wrapStream: async ({ doStream }) => {
      const record = await meter.admit()
      const result = await doStream()
      const stream = tapStreamUsage(
        result.stream as unknown as Parameters<typeof tapStreamUsage>[0],
        (terminal) => {
          if (terminal.usage === undefined && terminal.providerMetadata === undefined) return
          void record(callCostUsd(priceId, terminal.usage, terminal.providerMetadata))
        }
      )
      return { ...result, stream: stream as unknown as typeof result.stream }
    },
  }
}
