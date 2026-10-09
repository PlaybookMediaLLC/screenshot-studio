import 'server-only'

import { z } from 'zod'
import { type BrandKitValues } from '@/lib/launch/brand'
import { defuseMarkup } from '@/lib/launch/sanitize'
import { formatBrandKit } from './context'
import { CRITIQUE_INSTRUCTIONS } from './prompts'
import { runSubmitStage } from './run'

/**
 * Review a rendered visual against the spec, the brand kit, and legibility
 * before the agent may move on. Stored on the design and shown on the asset
 * board, so reviewers see why a visual passed.
 */

const score = z.number().int().min(1).max(5)

export const critiqueSchema = z.object({
  brand: score,
  issues: z.array(z.string().trim().min(1).max(300)).max(6),
  legibility: score,
  specFidelity: score,
  verdict: z.enum(['pass', 'fix']),
})
export type RenderCritique = z.infer<typeof critiqueSchema> & {
  modelId: string
  reviewedAt: string
}

export async function critiqueRender(input: {
  brand: BrandKitValues | null
  /** Spec claims the visual may draw on. */
  claims: string[]
  previewJpegBase64: string
  /** The text layers in the design, as written. */
  texts: string[]
}): Promise<RenderCritique | null> {
  const context = [
    `<visible_text>\n${input.texts.map((text) => `- ${defuseMarkup(text)}`).join('\n') || '(no text layers)'}\n</visible_text>`,
    `<spec_claims>\n${input.claims.map((claim) => `- ${defuseMarkup(claim)}`).join('\n')}\n</spec_claims>`,
    formatBrandKit(input.brand) ?? 'No brand kit is set; judge brand as visual consistency only.',
    'Review this render.',
  ].join('\n\n')
  try {
    const run = await runSubmitStage({
      description: 'Submit the review of the rendered visual.',
      maxSteps: 3,
      messages: [
        {
          content: [
            { text: context, type: 'text' },
            { data: input.previewJpegBase64, mediaType: 'image/jpeg', type: 'file' },
          ],
          role: 'user',
        },
      ],
      role: 'drafting',
      schema: critiqueSchema,
      system: CRITIQUE_INSTRUCTIONS,
      toolName: 'submitCritique',
      validate: () => [],
    })
    if (!run.value) return null
    const lowest = Math.min(run.value.brand, run.value.legibility, run.value.specFidelity)
    return {
      ...run.value,
      // A low score always means fix, whatever the verdict field says.
      modelId: run.modelId,
      reviewedAt: new Date().toISOString(),
      verdict: lowest < 4 ? 'fix' : run.value.verdict,
    }
  } catch (error) {
    console.error('Render critique failed.', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}
