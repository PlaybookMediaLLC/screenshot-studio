/**
 * The model catalog: the single place that maps an intent-named role onto a
 * concrete provider model id.
 *
 * Roles exist so call sites express *what kind of work* they are doing rather
 * than which model happens to be cheapest this quarter. Retargeting a role is a
 * one-line change here instead of an edit across 56 call sites.
 *
 * Ported from `@canvas/ai`. Values are OpenRouter ids; a bare id without a
 * vendor prefix is treated as an OpenAI model by `toOpenRouterModelId`.
 */

/**
 * Every model role the platform recognizes.
 *
 * - `fast` — high-volume tool summarization and extraction. The default.
 * - `deep` — multi-step reasoning, contract analysis, workflow proposals.
 * - `nano` — trivial classification where latency dominates quality.
 * - `drafting` — customer-facing marketing prose (launch copy, posts).
 */
export const MODEL_ROLES = ['fast', 'deep', 'nano', 'drafting'] as const

/**
 * A model role identifier. Derived from {@link MODEL_ROLES} so the list stays
 * the single source of truth.
 */
export type ModelRole = (typeof MODEL_ROLES)[number]

/**
 * Fallback model id per role, used when no environment override is set.
 *
 * Plain constants applied at the read site, so they cannot be skipped.
 */
export const DEFAULT_MODEL_IDS: Record<ModelRole, string> = {
  deep: 'anthropic/claude-opus-5.5',
  drafting: 'anthropic/claude-sonnet-5.5',
  fast: 'anthropic/claude-haiku-4.5',
  nano: 'anthropic/claude-haiku-4.5',
}

/**
 * Environment variable that overrides each role's model id.
 *
 * Overrides exist for incident response — pinning a role to a known-good model
 * without a deploy — not as the normal way to configure the platform. The
 * normal way is to edit {@link DEFAULT_MODEL_IDS}.
 */
export const MODEL_ENV_KEYS: Record<ModelRole, string> = {
  fast: 'PLATFORM_AI_MODEL_FAST',
  deep: 'PLATFORM_AI_MODEL_DEEP',
  nano: 'PLATFORM_AI_MODEL_NANO',
  drafting: 'PLATFORM_AI_MODEL_DRAFTING',
}

/**
 * Narrows an arbitrary string to a {@link ModelRole}.
 *
 * @param value - candidate role name, typically from config or a feature flag.
 * @returns true when the value is a recognized role.
 */
export function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value)
}
