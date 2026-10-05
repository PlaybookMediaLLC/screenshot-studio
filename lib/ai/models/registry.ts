/**
 * The model registry: the only place in the AI package that constructs a provider
 * model.
 *
 * Model-level middleware and per-role default settings attach here once, so no
 * call site can opt out of them.
 */

import { customProvider, type LanguageModel, wrapLanguageModel } from 'ai'
import { MODEL_ROLES, type ModelRole } from './catalog'
import { type EnvSource, resolveModelIds } from './env'
import { createModelMiddleware, type ModelMiddlewareOptions } from './middleware'
import { openRouterLanguageModel } from './provider'

/**
 * Role-addressed access to language models.
 */
export type ModelRegistry = {
  /**
   * Returns the language model bound to a role.
   *
   * @param role - the intent-named role to resolve.
   * @returns a provider language model ready to pass as `model:`.
   */
  languageModel(role: ModelRole): LanguageModel
  /**
   * Returns the concrete provider model id a role currently resolves to.
   *
   * Exposed for telemetry, logging, and persisted generation metadata.
   *
   * @param role - the intent-named role to resolve.
   * @returns the provider model id, e.g. `"gpt-4o-mini"`.
   */
  modelId(role: ModelRole): string
}

/**
 * Options for {@link createModelRegistry}.
 */
export type ModelRegistryOptions = ModelMiddlewareOptions & {
  /** Environment source for role overrides. Defaults to `process.env`. */
  env?: EnvSource
}

/**
 * Builds a model registry from an environment source.
 *
 * Prefer the shared {@link models} singleton in application code; this factory
 * exists so tests can drive resolution with an injected environment instead of
 * mutating `process.env`.
 *
 * Every model is wrapped with the role's middleware stack — output-token
 * backstop, usage observation, structured logging — so no call site can opt out
 * of them by accident.
 *
 * Model construction is eager but cheap: the provider defers credential and
 * network work to the first request, so building the registry at module load
 * does not require `OPENROUTER_API_KEY` to be present.
 *
 * @param options - environment source plus optional usage observer and logger.
 * @returns a registry exposing every role in {@link MODEL_ROLES}.
 *
 * @example
 * ```ts
 * const registry = createModelRegistry({
 *   env: { PLATFORM_AI_MODEL_FAST: "gpt-4.1-mini" },
 *   onUsage: (e) => meter.record(e.usage.totalTokens, { role: e.role }),
 * });
 * registry.modelId("fast"); // "gpt-4.1-mini"
 * ```
 */
export function createModelRegistry(options: ModelRegistryOptions = {}): ModelRegistry {
  const { env, ...middlewareOptions } = options
  const modelIds = resolveModelIds(env)

  const languageModels = {} as Record<ModelRole, LanguageModel>
  for (const role of MODEL_ROLES) {
    languageModels[role] = wrapLanguageModel({
      model: openRouterLanguageModel(modelIds[role]),
      middleware: createModelMiddleware(role, modelIds[role], middlewareOptions),
    })
  }

  const provider = customProvider({ languageModels })

  return {
    languageModel: (role: ModelRole) => provider.languageModel(role),
    modelId: (role: ModelRole) => modelIds[role],
  }
}

/**
 * The process-wide model registry.
 *
 * Resolved once from `process.env` at import time, matching how the raw
 * provider calls it replaces behaved.
 */
export const models: ModelRegistry = createModelRegistry()
