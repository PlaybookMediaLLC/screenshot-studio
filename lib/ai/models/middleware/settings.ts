/**
 * Per-role call-setting defaults.
 *
 * Without a backstop every generation is bounded only by the provider's own
 * ceiling, so a runaway generation can burn a context window of output tokens.
 *
 * These are **backstops, not budgets.** Each is set well above the p99 output
 * length for that role's workload, so it never truncates a legitimate answer;
 * it only stops a pathological one. Tuning these down to control cost is the
 * wrong lever — pick a cheaper model for the role instead.
 */

import { defaultSettingsMiddleware, type LanguageModelMiddleware } from 'ai'
import type { ModelRole } from '../catalog'

/**
 * Output-token backstop per role.
 *
 * `deep` gets the most headroom because it drives multi-step campaign planning,
 * which legitimately emits long structured objects. `nano` only classifies.
 */
export const MAX_OUTPUT_TOKENS: Record<ModelRole, number> = {
  fast: 8192,
  deep: 16_384,
  nano: 2048,
  drafting: 8192,
}

/**
 * Builds the default-settings middleware for a role.
 *
 * `defaultSettingsMiddleware` only fills in settings the caller left unset, so
 * a call site that passes its own `maxOutputTokens` still wins.
 *
 * @param role - the role whose backstop should apply.
 * @returns middleware applying that role's default call settings.
 */
export function createSettingsMiddleware(role: ModelRole): LanguageModelMiddleware {
  return defaultSettingsMiddleware({
    settings: { maxOutputTokens: MAX_OUTPUT_TOKENS[role] },
  })
}
