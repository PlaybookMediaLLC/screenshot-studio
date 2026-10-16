import { tool } from 'ai'
import { z } from 'zod'
import { designCatalogSections } from '@/lib/design/catalog'
import { describeDesignCatalog } from '@/lib/design/catalog-sections'
import { designEditSchema } from '@/lib/design/document'
import { variantCountSchema } from '@/lib/ai/variants'
import type { ToolCapability } from './executor'

/**
 * Tools for the in-editor copilot.
 *
 * The editing tools have no `execute`: the model's call returns to the
 * browser, which runs it against the live editor stores (the same actions the
 * editor's controls use) and replies with the result and a canvas snapshot.
 * The catalog lookup runs on the server.
 */

export const editorClientToolNames = ['inspectCanvas', 'applyChanges', 'undoLastChange', 'showVariants'] as const
export type EditorClientToolName = (typeof editorClientToolNames)[number]

/**
 * RFC 016 capability records, for documentation only: the browser runs these
 * tools against the editor the user already has open, not the executor. A
 * turn is at most four model steps.
 */
export const editorCopilotCapabilities = {
  applyChanges: { effect: 'draft', maxCallsPerRun: 4, permission: 'artifact:edit' },
  inspectCanvas: { effect: 'read', maxCallsPerRun: 4, permission: 'artifact:read' },
  listDesignOptions: { effect: 'read', maxCallsPerRun: 4, permission: 'workspace:read' },
  undoLastChange: { effect: 'draft', maxCallsPerRun: 4, permission: 'artifact:edit' },
} as const satisfies Record<string, ToolCapability>

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
    showVariants: tool({
      description:
        'Show the user several complete versions of the design side by side to pick from. Use it ' +
        'when they ask for versions, variants, options, or alternatives. It does not change the design.',
      inputSchema: z.object({
        count: variantCountSchema.describe('How many versions, 2 to 6.'),
        instruction: z.string().max(300).optional().describe('What the versions should explore, in the user’s words.'),
      }),
    }),
    undoLastChange: tool({
      description: 'Undo the most recent change, yours or the user’s. Returns a snapshot.',
      inputSchema: z.object({}),
    }),
  }
}
