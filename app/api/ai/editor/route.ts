import { generateText, type ModelMessage, stepCountIs } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { models } from '@/lib/ai/models'
import { EDITOR_COPILOT_INSTRUCTIONS, scopeInstructions } from '@/lib/ai/prompts/editor-copilot'
import { createEditorCopilotTools, editorClientToolNames } from '@/lib/ai/tools/editor-copilot'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { consumeWorkspaceQuota } from '@/lib/tenant/entitlements'

export const maxDuration = 120

/**
 * One step of the in-editor copilot loop.
 *
 * The browser owns the conversation: it posts the messages so far, this route
 * runs the model until it calls an editing tool, and the browser executes
 * that tool against the live editor and posts again with the result. Server
 * tools (catalog lookup) run here without a round trip.
 */

const MAX_MESSAGES = 80
const MAX_STEPS_PER_TURN = 16

const requestSchema = z.object({
  messages: z
    .array(
      z.looseObject({
        // The browser may not inject system or operator messages.
        role: z.enum(['user', 'assistant', 'tool']),
      })
    )
    .min(1)
    .max(MAX_MESSAGES),
  selection: z.string().max(200).nullable().default(null),
})

/** Only the newest snapshot is worth its tokens; older ones become a note. */
function trimSnapshots(messages: ModelMessage[]): ModelMessage[] {
  let latestFound = false
  return [...messages]
    .reverse()
    .map((message) => {
      if (message.role !== 'tool') return message
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type !== 'tool-result' || part.output.type !== 'content') return part
          if (!latestFound) {
            latestFound = true
            return part
          }
          return {
            ...part,
            output: {
              type: 'content' as const,
              value: part.output.value.map((item) =>
                item.type === 'file'
                  ? { text: '[earlier snapshot omitted]', type: 'text' as const }
                  : item
              ),
            },
          }
        }),
      }
    })
    .reverse()
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const access = await requireActiveOrganizationPermission(request.headers, 'artifact:edit')
    if (!isCampaignStudioConfigured()) {
      return NextResponse.json({ error: 'AI is not configured.' }, { status: 503 })
    }
    const { messages: rawMessages, selection } = requestSchema.parse(await request.json())
    const messages = rawMessages as unknown as ModelMessage[]

    const lastUser = messages.findLastIndex((message) => message.role === 'user')
    if (lastUser < 0)
      return NextResponse.json({ error: 'A user message is required.' }, { status: 400 })
    // One unit of the generation quota per user request, not per tool round trip.
    if (lastUser === messages.length - 1) {
      await consumeWorkspaceQuota(access.organizationId, 'generation:monthly')
    }
    const stepsThisTurn = messages
      .slice(lastUser)
      .filter((message) => message.role === 'assistant').length
    if (stepsThisTurn >= MAX_STEPS_PER_TURN) {
      return NextResponse.json({
        done: true,
        messages: [],
        pendingToolCalls: [],
        text: 'I stopped here to avoid going in circles. Tell me what to adjust next.',
      })
    }

    const result = await generateText({
      messages: trimSnapshots(messages),
      model: models.languageModel('deep'),
      stopWhen: stepCountIs(4),
      system: EDITOR_COPILOT_INSTRUCTIONS + scopeInstructions(selection),
      tools: createEditorCopilotTools(),
    })
    const clientTools = new Set<string>(editorClientToolNames)
    const pendingToolCalls = result.toolCalls
      .filter((call) => clientTools.has(call.toolName))
      .map((call) => ({ input: call.input, toolCallId: call.toolCallId, toolName: call.toolName }))
    return NextResponse.json({
      done: pendingToolCalls.length === 0,
      messages: result.response.messages,
      pendingToolCalls,
      text: result.text,
    })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
