import 'server-only'

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  type UIMessage,
} from 'ai'
import type { z } from 'zod'
import type { OrganizationAccess } from '@/lib/auth/access'
import { withAiCredits } from '@/lib/ai/metering'
import { models } from '@/lib/ai/models'
import {
  DOCUMENT_COPILOT_INSTRUCTIONS,
  DOCUMENT_EDITOR_INSTRUCTIONS,
} from '@/lib/ai/prompts/document-editor'
import type {
  documentChatRequestSchema,
  documentCopilotRequestSchema,
} from '@/lib/api/contracts/ai'

type DocumentChatRequest = z.infer<typeof documentChatRequestSchema>

/**
 * Streams the document AI menu's answer. The stream opens with the tool the
 * editor asked for (the editor applies `edit` as a replacement and the others
 * as inserted blocks), then the model's Markdown. The credit scope stays open
 * until the model finishes, so the whole stream is charged.
 */
export function streamDocumentChat(
  access: OrganizationAccess,
  body: DocumentChatRequest
): Promise<Response> {
  const toolName = body.ctx?.toolName ?? 'generate'
  return new Promise<Response>((resolve, reject) => {
    withAiCredits(access, async () => {
      const messages = await convertToModelMessages(body.messages as unknown as UIMessage[])
      const result = streamText({
        messages: [
          {
            content: `<document_context>\n${body.system ?? ''}\n</document_context>`,
            role: 'user',
          },
          ...messages,
        ],
        model: models.languageModel('drafting'),
        system: DOCUMENT_EDITOR_INSTRUCTIONS,
      })
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ data: toolName, type: 'data-toolName' })
          writer.merge(result.toUIMessageStream({ sendStart: false }))
        },
      })
      resolve(createUIMessageStreamResponse({ stream }))
      await result.consumeStream()
    }).catch(reject)
  })
}

/** One inline completion for the document copilot. */
export function completeDocumentText(
  access: OrganizationAccess,
  body: z.infer<typeof documentCopilotRequestSchema>
): Promise<{ text: string }> {
  return withAiCredits(access, async () => {
    const { text } = await generateText({
      model: models.languageModel('fast'),
      prompt: body.prompt,
      system: DOCUMENT_COPILOT_INSTRUCTIONS,
    })
    return { text: text.trim() || '0' }
  })
}
