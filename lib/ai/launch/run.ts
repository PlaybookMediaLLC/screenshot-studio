import 'server-only'

import { generateText, type ModelMessage, stepCountIs, tool, type ToolSet } from 'ai'
import type { z } from 'zod'
import { type ModelRole, models, normalizeTokenUsage } from '../models'

/**
 * Run one model stage that ends in a validated submission.
 *
 * The model gets a single submit tool whose input schema is the stage's
 * output schema. The tool runs the stage's checks (citations, references,
 * guards) and returns the problems, so the model corrects itself in the same
 * run; the run stops as soon as a submission passes. Providers cap how many
 * optional fields constrained JSON output may have, and these schemas exceed
 * it, so tool input is the reliable path (validated here, not by the provider).
 */

export type StageResult<T> = {
  /** The last submission even if it failed checks, for a best-effort fallback. */
  lastAttempt: unknown
  modelId: string
  steps: number
  text: string
  usage: { inputTokens: number | undefined; outputTokens: number | undefined }
  value: T | null
}

export async function runSubmitStage<T>(input: {
  description: string
  extraTools?: ToolSet
  maxSteps?: number
  messages?: ModelMessage[]
  prompt?: string
  role: ModelRole
  schema: z.ZodType<T>
  system: string
  toolName: string
  validate: (value: T) => string[] | Promise<string[]>
}): Promise<StageResult<T>> {
  let accepted: T | null = null
  let lastAttempt: unknown = null
  const submit = tool({
    description: input.description,
    execute: async (value: T) => {
      lastAttempt = value
      const issues = await input.validate(value)
      if (issues.length > 0) {
        return { issues: issues.slice(0, 40), ok: false as const }
      }
      accepted = value
      return { ok: true as const }
    },
    inputSchema: input.schema,
  })
  const common = {
    model: models.languageModel(input.role),
    stopWhen: [stepCountIs(input.maxSteps ?? 5), () => accepted !== null],
    system: input.system,
    tools: { [input.toolName]: submit, ...input.extraTools },
  }
  const result = input.messages
    ? await generateText({ ...common, messages: input.messages })
    : await generateText({ ...common, prompt: input.prompt ?? '' })
  const usage = normalizeTokenUsage(result.totalUsage)
  return {
    lastAttempt,
    modelId: models.modelId(input.role),
    steps: result.steps.length,
    text: result.text,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    value: accepted,
  }
}

/** Audit metadata for a stage. Keys avoid "token": the audit sanitizer redacts them. */
export function stageMetadata(result: StageResult<unknown>): Record<string, unknown> {
  return {
    inputUsage: result.usage.inputTokens,
    modelId: result.modelId,
    outputUsage: result.usage.outputTokens,
    steps: result.steps,
  }
}
