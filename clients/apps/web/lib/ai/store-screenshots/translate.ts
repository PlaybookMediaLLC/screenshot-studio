import 'server-only'

import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { models } from '@/lib/ai/models'
import type { TranslateRequest } from '@/lib/api/contracts/store-screenshots'

/**
 * Store screenshot translation. Only the listed strings (and the optional
 * product context the user typed) are sent to the model: never screenshots,
 * never other project data. Results are validated so every requested id
 * comes back exactly once.
 */

/** Tool the model must call with its translations. */
export const SUBMIT_TRANSLATIONS_TOOL = 'submitTranslations'

const INSTRUCTIONS = `You translate marketing copy shown on App Store and Google Play screenshots.
Rules:
- Translate each item from the source locale into the target locale for a native reader of that market.
- Keep it as short as the source or shorter; screenshot headlines must fit a small space.
- Keep numbered tags exactly, around the equivalent words: <0>…</0>, <1>…</1>.
- Keep brand and product names, numbers, and line breaks (\\n) as they are.
- Do not add claims, superlatives, prices, or facts that are not in the source.
- Call ${SUBMIT_TRANSLATIONS_TOOL} once with every id.`

/** Thrown when the model's answer does not cover the request. */
export class TranslationResultError extends Error {
  /** Create a result error. */
  constructor(message: string) {
    super(message)
    this.name = 'TranslationResultError'
  }
}

/** Translate a batch of strings into one locale. */
export async function translateStrings(request: TranslateRequest): Promise<Array<{ id: string; text: string }>> {
  const ids = new Set(request.items.map((item) => item.id))
  const result = await generateText({
    model: models.languageModel('fast'),
    system: INSTRUCTIONS,
    prompt: [
      `Source locale: ${request.sourceLocale}`,
      `Target locale: ${request.targetLocale}`,
      request.context ? `Product context (for terminology only):\n${request.context}` : '',
      `Items:\n${JSON.stringify(request.items)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    tools: {
      [SUBMIT_TRANSLATIONS_TOOL]: tool({
        description: 'Submit the translation of every item.',
        inputSchema: z.object({
          translations: z.array(z.object({ id: z.string(), text: z.string().max(900) })),
        }),
      }),
    },
    toolChoice: { type: 'tool', toolName: SUBMIT_TRANSLATIONS_TOOL },
    stopWhen: stepCountIs(1),
  })
  const call = result.toolCalls.find((item) => item.toolName === SUBMIT_TRANSLATIONS_TOOL)
  const parsed = z
    .object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) })
    .safeParse(call?.input)
  if (!parsed.success) throw new TranslationResultError('The translation service returned an unreadable answer.')
  const seen = new Map(parsed.data.translations.filter((item) => ids.has(item.id) && item.text.trim()).map((item) => [item.id, item.text]))
  if (seen.size !== ids.size) throw new TranslationResultError('The translation service skipped some strings. Try again.')
  return request.items.map((item) => ({ id: item.id, text: seen.get(item.id)! }))
}
