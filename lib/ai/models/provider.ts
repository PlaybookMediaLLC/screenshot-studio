import { createOpenRouter, type OpenRouterChatSettings } from '@openrouter/ai-sdk-provider'

const OPENAI_MODEL_PREFIX = 'openai/'
const ANTHROPIC_MODEL_PREFIX = 'anthropic/'

/**
 * Qualifies an existing OpenAI model id for OpenRouter without changing the
 * selected model. Already-qualified ids are left unchanged so incident
 * overrides can use OpenRouter's native model format.
 */
export function toOpenRouterModelId(modelId: string): string {
  return modelId.includes('/') ? modelId : `${OPENAI_MODEL_PREFIX}${modelId}`
}

/**
 * Settings every model gets. Usage accounting returns each call's cost, which
 * the AI credit meter charges. On Anthropic models, automatic prompt caching
 * marks the newest message each step, so a multi-step agent reads its growing
 * history from cache instead of paying full input price for it every step.
 */
export function openRouterSettings(modelId: string): OpenRouterChatSettings {
  return {
    usage: { include: true },
    ...(modelId.startsWith(ANTHROPIC_MODEL_PREFIX) ? { cache_control: { type: 'ephemeral' } } : {}),
  }
}

/** Shared OpenRouter provider. Credentials are read from OPENROUTER_API_KEY. */
export const openRouterProvider = createOpenRouter()

/** Resolves an existing language model through OpenRouter. */
export function openRouterLanguageModel(modelId: string) {
  const id = toOpenRouterModelId(modelId)
  return openRouterProvider(id, openRouterSettings(id))
}
