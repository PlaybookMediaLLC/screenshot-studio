import type { FillImage } from './blocks'
import { artboardRect, boundsOf, type Artboard } from './document'
import { ARTBOARD_GAP } from './layout'
import {
  buildRecipe,
  type CanvasRecipe,
  type RecipeInput,
  type ReleaseEvidence,
} from './recipes'

/**
 * How a release becomes a canvas, shared by the browser's "from a release"
 * start and release automation on the server, so both lay out the same
 * artboards from the same record.
 */

/** Groups of artboards stacked top to bottom, one row per group. */
export function stacked(...groups: Artboard[][]): Artboard[] {
  const placed: Artboard[] = []
  for (const group of groups) {
    const bounds = boundsOf(placed.map(artboardRect))
    const shift = bounds ? bounds.y + bounds.height + ARTBOARD_GAP : 0
    placed.push(...group.map((artboard) => ({ ...artboard, y: artboard.y + shift })))
  }
  return placed
}

/** A release's own words as recipe evidence; recipes never invent claims beyond it. */
export function releaseEvidence(release: {
  id: string
  title: string
  benefitStatement?: string | null
  features?: { title?: string | null; url?: string | null }[] | null
}): ReleaseEvidence {
  return {
    id: release.id,
    title: release.title.slice(0, 300),
    benefitStatement: release.benefitStatement?.slice(0, 300) || undefined,
    features: (release.features ?? [])
      .filter((feature) => feature.title?.trim())
      .slice(0, 20)
      .map((feature) => ({
        title: feature.title!.slice(0, 300),
        ...(feature.url && /^https?:\/\//.test(feature.url) ? { url: feature.url } : {}),
      })),
  }
}

/** A release laid out with recipes, each recipe's artboards as one row, in order. */
export function releaseCanvas(
  recipes: readonly CanvasRecipe[],
  input: RecipeInput,
  options: { newId?: () => string; fill?: FillImage } = {}
): Artboard[] {
  return stacked(...recipes.map((recipe) => buildRecipe(recipe, input, options)))
}
