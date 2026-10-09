/**
 * Validated environment access for model selection.
 *
 * A plain Zod schema parsed here, with constant fallbacks applied at the read
 * site, so an unset or malformed override can never hand the provider an
 * undefined model id.
 */

import { z } from 'zod'
import { DEFAULT_MODEL_IDS, MODEL_ENV_KEYS, MODEL_ROLES, type ModelRole } from './catalog'

/**
 * A source of environment variables. Injected rather than read from
 * `process.env` directly so resolution is testable .
 */
export type EnvSource = Record<string, string | undefined>

/**
 * Treats empty and whitespace-only strings as unset.
 *
 * Deployment tooling frequently materializes an unset variable as `""`; without
 * this an empty override would win over the catalog default and produce an
 * invalid provider model.
 */
const optionalModelId = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))
  .optional()
  .catch(undefined)

/**
 * Schema for the model-override environment variables.
 *
 * Keys are listed explicitly rather than generated from {@link MODEL_ENV_KEYS}
 * so the shape stays statically typed; `env.test.ts` asserts the two never
 * drift apart.
 */
export const modelEnvSchema = z.object({
  PLATFORM_AI_MODEL_FAST: optionalModelId,
  PLATFORM_AI_MODEL_DEEP: optionalModelId,
  PLATFORM_AI_MODEL_NANO: optionalModelId,
  PLATFORM_AI_MODEL_DRAFTING: optionalModelId,
})

/**
 * Parsed model-override environment.
 */
export type ModelEnv = z.infer<typeof modelEnvSchema>

/**
 * Parses model overrides out of an environment source.
 *
 * Never throws: a malformed override degrades to "unset" so a bad value in one
 * variable cannot take down every AI path in the process. Individual fields use
 * `.catch(undefined)` to make that per-field rather than all-or-nothing.
 *
 * @param source - environment record, defaulting to `process.env`.
 * @returns the parsed overrides, with unset and invalid entries as `undefined`.
 */
export function parseModelEnv(source: EnvSource = process.env): ModelEnv {
  return modelEnvSchema.parse(source)
}

/**
 * Resolves the concrete model id for every role.
 *
 * Precedence is override-then-default, per role, so pinning one role during an
 * incident leaves the others on the catalog.
 *
 * @param source - environment record, defaulting to `process.env`.
 * @returns a complete role-to-model-id map.
 *
 * @example
 * ```ts
 * resolveModelIds({ PLATFORM_AI_MODEL_FAST: "gpt-4.1-mini" });
 * // { fast: "gpt-4.1-mini", deep: "gpt-4o", nano: "gpt-4.1-nano", … }
 * ```
 */
export function resolveModelIds(source: EnvSource = process.env): Record<ModelRole, string> {
  const overrides = parseModelEnv(source) as Record<string, string | undefined>
  const resolved = {} as Record<ModelRole, string>

  for (const role of MODEL_ROLES) {
    resolved[role] = overrides[MODEL_ENV_KEYS[role]] ?? DEFAULT_MODEL_IDS[role]
  }

  return resolved
}
