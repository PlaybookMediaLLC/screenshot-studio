import 'server-only'

import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import type { TenantContext } from '@/lib/auth/access'
import { describeWholeCatalog } from '@/lib/design/catalog-sections'
import {
  type DesignChanges,
  type DesignDocument,
  definedChanges,
  designChangesSchema,
  patchDesignDocument,
} from '@/lib/design/document'
import { renderDesignForTenant } from '@/lib/design/render-design'
import { createDesignRenderer, type DesignRenderer } from '@/lib/design/renderer'
import { createTenantDownloadUrl } from '@/lib/storage/client'
import { createDesign } from '@/lib/tenant/designs'
import { models } from '../models'

/** Previews in flight at once; the render service queues anything beyond its own limit. */
const PREVIEW_CONCURRENCY = 3
import {
  EDITOR_CRITIC_INSTRUCTIONS,
  EDITOR_DIRECTIONS_INSTRUCTIONS,
} from '../prompts/editor-copilot'

/**
 * One-shot editor assistants: the critic (one-click improvement chips) and
 * the directions explorer (rendered variations to choose from).
 *
 * Proposals arrive as tool calls rather than structured output. The change
 * schema is far richer than the optional-field limits providers put on
 * constrained JSON; tool arguments are validated here instead, and an invalid
 * proposal is reported back so the model can correct it in the same run.
 * Every accepted proposal patches the current document into a valid one, so
 * applying it can never produce a design the editor cannot load.
 */

type Proposal = { changes: DesignChanges; reason: string; title: string }

function designContext(document: DesignDocument): string {
  return `<catalog>${describeWholeCatalog()}</catalog>\n<design>${JSON.stringify(document)}</design>`
}

/** Changes that patch the current document into a valid one, or null. */
function applicable(document: DesignDocument, changes: unknown): DesignChanges | null {
  try {
    const cleaned = definedChanges(designChangesSchema.parse(changes)) as DesignChanges
    patchDesignDocument(document, cleaned)
    return cleaned
  } catch {
    return null
  }
}

function proposalTool(
  description: string,
  document: DesignDocument,
  limit: number,
  proposals: Proposal[]
) {
  return tool({
    description,
    execute: async (input: { changes: unknown; reason: string; title: string }) => {
      if (proposals.length >= limit) return { error: 'Enough proposals already.', ok: false }
      const changes = applicable(document, input.changes)
      if (!changes) {
        return {
          error: 'Those changes do not produce a valid design. Check option ids and units.',
          ok: false,
        }
      }
      proposals.push({ changes, reason: input.reason, title: input.title })
      return { ok: true }
    },
    inputSchema: z.object({
      changes: designChangesSchema,
      reason: z.string().max(200).describe('One sentence on why.'),
      title: z.string().max(60).describe('A short name for the proposal.'),
    }),
  })
}

export async function critiqueDesign(document: DesignDocument, snapshotJpegBase64: string | null) {
  const suggestions: Proposal[] = []
  await generateText({
    messages: [
      {
        content: [
          { text: designContext(document), type: 'text' },
          ...(snapshotJpegBase64
            ? [{ data: snapshotJpegBase64, mediaType: 'image/jpeg', type: 'file' as const }]
            : []),
        ],
        role: 'user',
      },
    ],
    model: models.languageModel('drafting'),
    stopWhen: stepCountIs(4),
    system: `${EDITOR_CRITIC_INSTRUCTIONS}\n\nCall proposeSuggestion once per suggestion (at most three), then stop. If nothing needs fixing, call nothing.`,
    tools: {
      proposeSuggestion: proposalTool(
        'Propose one improvement with the exact changes to apply.',
        document,
        3,
        suggestions
      ),
    },
  })
  return suggestions
}

export async function exploreDesignDirections(
  tenant: TenantContext,
  document: DesignDocument,
  options: { count: number; direction?: string }
) {
  const proposals: Proposal[] = []
  await generateText({
    messages: [
      {
        content: `${designContext(document)}\n\nPropose ${options.count} variations.${
          options.direction ? ` The user wants: ${options.direction}` : ''
        }`,
        role: 'user',
      },
    ],
    model: models.languageModel('deep'),
    stopWhen: stepCountIs(6),
    system: `${EDITOR_DIRECTIONS_INSTRUCTIONS}\n\nCall proposeDirection once per variation, then stop.`,
    tools: {
      proposeDirection: proposalTool(
        'Propose one variation with the exact changes that produce it.',
        document,
        options.count,
        proposals
      ),
    },
  })

  const base = await createDesign(tenant, { document, name: 'Editor design' })
  // Started on the first cache miss, so a fully cached batch never opens a browser.
  const lazy: { renderer: Promise<DesignRenderer> | null } = { renderer: null }
  const getRenderer = () => (lazy.renderer ??= createDesignRenderer())
  try {
    // Previews only: a 1x JPEG renders faster and loads faster than the 2x
    // PNG export, and choosing a direction loads the design, not the image.
    const rendered = await mapWithConcurrency(proposals, PREVIEW_CONCURRENCY, async (proposal) => {
      const design = await createDesign(tenant, {
        document: patchDesignDocument(document, proposal.changes),
        name: proposal.title,
        parentDesignId: base.id,
      })
      try {
        const preview = await renderDesignForTenant(tenant, getRenderer, design, {
          format: 'jpeg',
          scale: 1,
        })
        return {
          designId: design.id,
          name: proposal.title,
          previewUrl: await createTenantDownloadUrl({
            expiresIn: 900,
            objectKey: preview.asset.objectKey,
            organizationId: tenant.organizationId,
          }).catch(() => null),
          rationale: proposal.reason,
        }
      } catch (error) {
        console.error('Direction render failed.', {
          designId: design.id,
          reason: error instanceof Error ? error.message : 'unknown',
        })
        return null
      }
    })
    return {
      baseDesignId: base.id,
      directions: rendered.filter((direction) => direction !== null),
    }
  } finally {
    if (lazy.renderer) await (await lazy.renderer).close().catch(() => undefined)
  }
}

/** Run `work` over `items` with at most `limit` in flight, keeping input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  })
  await Promise.all(runners)
  return results
}
