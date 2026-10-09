/**
 * Role-addressed model selection, routed through OpenRouter.
 *
 * @example
 * ```ts
 * import { models } from '@/lib/ai/models'
 *
 * const { text } = await generateText({ model: models.languageModel('drafting'), prompt })
 * ```
 */

export {
  DEFAULT_MODEL_IDS,
  isModelRole,
  MODEL_ENV_KEYS,
  MODEL_ROLES,
  type ModelRole,
} from './catalog'
export {
  type EnvSource,
  type ModelEnv,
  modelEnvSchema,
  parseModelEnv,
  resolveModelIds,
} from './env'
export {
  createModelMiddleware,
  MAX_OUTPUT_TOKENS,
  type ModelLogger,
  type ModelMiddlewareOptions,
  normalizeTokenUsage,
  type TokenUsage,
  type UsageEvent,
  type UsageObserver,
} from './middleware'
export { createModelRegistry, type ModelRegistry, models } from './registry'
export { openRouterLanguageModel, openRouterProvider, toOpenRouterModelId } from './provider'
