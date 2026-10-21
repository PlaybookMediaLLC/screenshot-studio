'use client'

import { memo, useMemo } from 'react'
import { DocumentPreview, useNearViewport } from '@/components/design/DocumentPreview'
import { recipePreview } from '@/lib/canvas/recipe-preview'
import { CANVAS_RECIPES, type CanvasRecipe } from '@/lib/canvas/recipes'
import { documentCanvasSize } from '@/lib/export/adapt'
import type { Artboard } from '@/lib/canvas/document'

function Frames({ artboards }: { artboards: Artboard[] }) {
  const aspects = artboards.map(({ document }) => {
    const { width, height } = documentCanvasSize(document)
    return width / height
  })
  return (
    <div
      className="grid w-full items-center gap-2"
      style={{ gridTemplateColumns: aspects.map((aspect) => `${aspect}fr`).join(' ') }}
    >
      {artboards.map((artboard, index) => (
        <div
          key={artboard.id}
          className="min-w-0 overflow-hidden rounded-sm bg-foreground/[0.06]"
          style={{ aspectRatio: aspects[index] }}
        >
          <DocumentPreview alt="" document={artboard.document} />
        </div>
      ))}
    </div>
  )
}

function PreviewContent({ recipe }: { recipe: CanvasRecipe }) {
  const artboards = useMemo(() => recipePreview(recipe), [recipe])
  if (CANVAS_RECIPES[recipe].preview?.layout === 'sequence')
    return (
      <div className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto] gap-2">
        <div className="min-h-0">
          <DocumentPreview alt="" document={artboards[0].document} />
        </div>
        <Frames artboards={artboards.slice(1)} />
      </div>
    )
  return artboards.length === 1 ? (
    <DocumentPreview alt="" document={artboards[0].document} />
  ) : (
    <Frames artboards={artboards} />
  )
}

/** Decorative, lazily built template artboards rendered by the same stage as library cards. */
export const RecipePreview = memo(function RecipePreview({ recipe }: { recipe: CanvasRecipe }) {
  const [ref, near] = useNearViewport<HTMLDivElement>()
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-recipe-preview={recipe}
      className="pointer-events-none mb-3 flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-md border bg-foreground/[0.03] p-3"
    >
      {near ? (
        <PreviewContent recipe={recipe} />
      ) : (
        <div className="h-full w-full rounded-sm bg-foreground/[0.06]" />
      )}
    </div>
  )
})
