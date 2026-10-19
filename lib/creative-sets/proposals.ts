import { z } from 'zod'
import { applySetCommand } from './commands'
import { type CreativeSetDocument } from './document'

export const storyProposalRequestSchema = z.object({
  creativeSetId: z.string().cuid(),
  baseRevision: z.number().int().positive(),
  storyId: z.string().min(1).max(80),
  outputId: z.string().min(1).max(80),
  scope: z.enum(['story', 'output']),
  facts: z.string().trim().min(20).max(3000),
})
export const storyCopyProposalSchema = z.object({
  headline: z.string().trim().min(1).max(70),
  supporting: z.string().max(130),
  reason: z.string().max(240),
})

/** Validated proposals use ordinary commands and enter history only when explicitly kept. */
export function applyStoryProposal(
  set: CreativeSetDocument,
  request: z.infer<typeof storyProposalRequestSchema>,
  input: z.infer<typeof storyCopyProposalSchema>
): CreativeSetDocument {
  const proposal = storyCopyProposalSchema.parse(input)
  const output = set.outputs.find(
    (output) => output.id === request.outputId && output.storyId === request.storyId
  )
  if (!output) throw new Error('The selected story or format no longer exists.')
  let next = set
  for (const field of ['headline', 'supporting'] as const)
    next = applySetCommand(
      next,
      request.scope === 'story'
        ? { type: 'story-copy', storyId: request.storyId, field, value: proposal[field] }
        : { type: 'output-copy', outputId: request.outputId, field, value: proposal[field] }
    )
  return next
}
