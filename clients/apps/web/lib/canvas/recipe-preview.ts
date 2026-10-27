'use client'

import { solidFill } from './blocks'
import type { Artboard } from './document'
import { buildRecipe, CANVAS_RECIPES, type CanvasRecipe } from './recipes'

const previews = new Map<CanvasRecipe, Artboard[]>()

/** Build each gallery sample once, using only template copy and neutral screenshot slots. */
export function recipePreview(recipe: CanvasRecipe): Artboard[] {
  const cached = previews.get(recipe)
  if (cached) return cached
  const info = CANVAS_RECIPES[recipe]
  const count = info.preview?.screenshots ?? info.screenshots
  const screenshots = Array.from({ length: count }, () => ({
    src: solidFill('#dfe5e2', 16 / 10),
    name: 'Screenshot placeholder',
    width: 1600,
    height: 1000,
  }))
  let id = 0
  const artboards = buildRecipe(recipe, { screenshots }, { newId: () => `${recipe}-${++id}` })
  previews.set(recipe, artboards)
  return artboards
}
