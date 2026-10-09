import { tool } from 'ai'
import { z } from 'zod'
import { designCatalogSections } from '@/lib/design/catalog'
import { describeDesignCatalog } from '@/lib/design/catalog-sections'
import { designEditSchema } from '@/lib/design/document'

/**
 * Tools for the in-editor copilot.
 *
 * The editing tools have no `execute`: the model's call returns to the
 * browser, which runs it against the live editor stores (the same actions the
 * editor's controls use) and replies with the result and a canvas snapshot.
 * The catalog lookup runs on the server.
 */

export const editorClientToolNames = ['inspectCanvas', 'applyChanges', 'undoLastChange'] as const
export type EditorClientToolName = (typeof editorClientToolNames)[number]

export function createEditorCopilotTools() {
  return {
    applyChanges: tool({
      description:
        'Change the live design. Send only the sections you are changing; lists replace the ' +
        'whole list. Returns a snapshot of the canvas after the change. One call is one undo step.',
      inputSchema: designEditSchema,
    }),
    inspectCanvas: tool({
      description:
        'See the current design document, the selected element, and a snapshot of the canvas.',
      inputSchema: z.object({}),
    }),
    listDesignOptions: tool({
      description:
        'Look up option ids: templates, aspectRatios, backgrounds, fonts, mockups, frames, ' +
        'overlays, animation.',
      execute: async ({ section }) => ({ options: describeDesignCatalog(section), section }),
      inputSchema: z.object({ section: z.enum(designCatalogSections) }),
    }),
    undoLastChange: tool({
      description: 'Undo the most recent change, yours or the user’s. Returns a snapshot.',
      inputSchema: z.object({}),
    }),
  }
}
