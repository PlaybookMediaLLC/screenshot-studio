import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const OPENAI_MODEL_PREFIX = 'openai/'

/**
 * Qualifies an existing OpenAI model id for OpenRouter without changing the
 * selected model. Already-qualified ids are left unchanged so incident
 * overrides can use OpenRouter's native model format.
 */
export function toOpenRouterModelId(modelId: string): string {
  return modelId.includes('/') ? modelId : `${OPENAI_MODEL_PREFIX}${modelId}`
}

/** Shared OpenRouter provider. Credentials are read from OPENROUTER_API_KEY. */
export const openRouterProvider = createOpenRouter()

/** Resolves an existing language model through OpenRouter. */
export function openRouterLanguageModel(modelId: string) {
  return openRouterProvider(toOpenRouterModelId(modelId))
}
