'use client'

import type { ModelMessage, ToolResultPart } from 'ai'
import { useCallback, useRef, useState } from 'react'
import { applyDesignChanges } from '@/lib/design/apply'
import { type DesignChanges, designEditSchema } from '@/lib/design/document'
import { describeSelection, exportDesignDocument } from '@/lib/design/export'
import { captureCanvasSnapshot } from '@/lib/design/snapshot'
import { useImageStore } from '@/lib/store'

/**
 * The in-editor copilot loop.
 *
 * The server runs the model; whenever it calls an editing tool, the call comes
 * back here and runs against the live editor stores, through the same actions
 * the editor's controls use. Each result goes back with a canvas snapshot so
 * the model sees what it did. Every applied change is one undo step.
 */

export type CopilotEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'change'; summary: string }
  | { kind: 'error'; text: string }

type PendingToolCall = { input: unknown; toolCallId: string; toolName: string }

type StepResponse = {
  done: boolean
  error?: string
  messages: ModelMessage[]
  pendingToolCalls: PendingToolCall[]
  text: string
}

const MAX_ROUND_TRIPS = 16

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

/** The model may restyle the design but never swap the user's images. */
function withoutImageSources(changes: DesignChanges): DesignChanges {
  const { image, devices, ...rest } = changes
  return {
    ...rest,
    ...(image ? { image: { ...image, src: undefined } } : {}),
    ...(devices
      ? {
          devices: {
            ...devices,
            mockups: devices.mockups.map((mockup) => ({
              ...mockup,
              screen: { ...mockup.screen, src: null },
            })),
          },
        }
      : {}),
  } as DesignChanges
}

async function snapshotParts(text: string): Promise<ToolResultPart['output']> {
  await nextFrame()
  const snapshot = await captureCanvasSnapshot()
  return {
    type: 'content',
    value: [
      { text, type: 'text' },
      ...(snapshot
        ? [
            {
              data: { data: snapshot, type: 'data' as const },
              mediaType: 'image/jpeg',
              type: 'file' as const,
            },
          ]
        : []),
    ],
  }
}

export async function runEditorTool(
  call: PendingToolCall,
  onChange: (summary: string) => void
): Promise<ToolResultPart['output']> {
  switch (call.toolName) {
    case 'inspectCanvas':
      return snapshotParts(
        JSON.stringify({
          design: exportDesignDocument(),
          selection: describeSelection()?.label ?? null,
        })
      )
    case 'applyChanges': {
      const parsed = designEditSchema.safeParse(call.input)
      if (!parsed.success) {
        return {
          type: 'error-text',
          value: `Invalid changes: ${parsed.error.message.slice(0, 600)}`,
        }
      }
      try {
        await applyDesignChanges(withoutImageSources(parsed.data.changes), (ref) => ref)
      } catch (error) {
        return {
          type: 'error-text',
          value: `The change could not be applied: ${error instanceof Error ? error.message : 'unknown'}`,
        }
      }
      onChange(parsed.data.summary)
      return snapshotParts(JSON.stringify({ applied: true, summary: parsed.data.summary }))
    }
    case 'undoLastChange':
      useImageStore.temporal.getState().undo()
      onChange('Undid the last change')
      return snapshotParts(JSON.stringify({ undone: true }))
    default:
      return { type: 'error-text', value: `Unknown tool ${call.toolName}.` }
  }
}

export function useEditorCopilot() {
  const [entries, setEntries] = useState<CopilotEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const messages = useRef<ModelMessage[]>([])

  const push = useCallback(
    (entry: CopilotEntry) => setEntries((current) => [...current, entry]),
    []
  )

  const send = useCallback(
    async (text: string, selection: string | null) => {
      if (!text.trim() || isRunning) return
      setIsRunning(true)
      push({ kind: 'user', text })
      messages.current = [...messages.current, { content: text, role: 'user' }]
      try {
        for (let trip = 0; trip < MAX_ROUND_TRIPS; trip += 1) {
          const response = await fetch('/api/ai/editor', {
            body: JSON.stringify({ messages: messages.current, selection }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
          const step = (await response.json()) as StepResponse
          if (!response.ok) throw new Error(step.error ?? 'The copilot is unavailable.')
          messages.current = [...messages.current, ...step.messages]
          if (step.text) push({ kind: 'assistant', text: step.text })
          if (step.done) break
          const results: ToolResultPart[] = []
          for (const call of step.pendingToolCalls) {
            results.push({
              output: await runEditorTool(call, (summary) => push({ kind: 'change', summary })),
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              type: 'tool-result',
            })
          }
          messages.current = [...messages.current, { content: results, role: 'tool' }]
        }
      } catch (error) {
        push({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Something went wrong.',
        })
      } finally {
        setIsRunning(false)
      }
    },
    [isRunning, push]
  )

  const reset = useCallback(() => {
    messages.current = []
    setEntries([])
  }, [])

  return { entries, isRunning, reset, send }
}
