import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'

/** Most messages one copilot request may carry. */
export const MAX_EDITOR_MESSAGES = 80

/** Roles the browser may send. It may not inject system or operator messages. */
export const editorMessageRoleSchema = z.enum(['user', 'assistant', 'tool'])

/** Roles the model's response messages carry. */
export const editorResponseRoleSchema = z.enum(['assistant', 'tool'])

/** One step of the in-editor copilot loop, as the browser posts it. */
export const editorCopilotRequestSchema = z.object({
  messages: z
    .array(z.looseObject({ role: editorMessageRoleSchema }))
    .min(1)
    .max(MAX_EDITOR_MESSAGES),
  selection: z.string().max(200).nullable().default(null),
})

/**
 * The model's turn. `messages` are AI SDK response messages the browser
 * echoes back verbatim, so they pass through with every key intact.
 */
export const editorCopilotResponseSchema = z.object({
  done: z.boolean(),
  messages: z.array(z.looseObject({ role: editorResponseRoleSchema })),
  pendingToolCalls: z.array(
    z.object({ input: z.unknown(), toolCallId: z.string(), toolName: z.string() })
  ),
  text: z.string(),
})

/** `POST /api/ai/editor` */
export const editorCopilotContract = defineContract({
  body: editorCopilotRequestSchema,
  method: 'POST',
  name: 'ai.editor',
  output: editorCopilotResponseSchema,
  path: '/api/ai/editor',
  summary: 'Run one step of the editor copilot',
})
