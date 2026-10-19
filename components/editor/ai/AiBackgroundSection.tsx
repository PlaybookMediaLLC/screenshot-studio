'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useHydratedSession } from '@/lib/auth/client'
import { useBrandKits } from '@/lib/brand/library'
import { applyDesignChanges } from '@/lib/design/apply'
import { fetchAssetUrl } from '@/lib/design/open-design'
import { rememberUploadedSources } from '@/lib/design/upload-sources'
import { imagePalette } from '@/lib/editor/palette'
import { selectScreenshot, useImageStore } from '@/lib/store'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
import { SectionWrapper } from '../sections/SectionWrapper'
import { Textarea } from '@/components/ui/textarea'

type PaletteSource = 'none' | 'screenshot' | 'brand'
type Result = { assetId: string; prompt: string; url: string }

const ASPECTS = [
  ['1:1', 1],
  ['4:5', 0.8],
  ['3:4', 0.75],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
  ['5:4', 1.25],
  ['4:3', 4 / 3],
  ['3:2', 1.5],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
] as const

/** The generator's aspect ratio closest to the canvas. */
function nearestAspect(width: number, height: number) {
  const ratio = width / height
  return ASPECTS.reduce((best, entry) =>
    Math.abs(Math.log(entry[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? entry : best
  )[0]
}

/**
 * Generate a background from a description, in the brand kit's colours or
 * the screenshot's own. Every result stays listed for the session, so going
 * back to an earlier one is a click; applying one is a normal image
 * background (one undo step) that saves and exports like any other.
 */
export function AiBackgroundSection() {
  const { data: session } = useHydratedSession()
  const trpcClient = useTRPCClient()
  const kits = useBrandKits((state) => state.kits)
  const binding = useImageStore((state) => state.brand)
  const screenshot = useImageStore((state) => selectScreenshot(state).src)
  const canvas = useImageStore((state) => state.canvasDimensions)
  const [available, setAvailable] = React.useState(false)
  const [prompt, setPrompt] = React.useState('')
  const [source, setSource] = React.useState<PaletteSource>('none')
  const [palette, setPalette] = React.useState<string[]>([])
  const [pending, setPending] = React.useState(false)
  const [results, setResults] = React.useState<Result[]>([])
  const kit = kits.find((candidate) => candidate.name === binding?.name) ?? kits[0]

  React.useEffect(() => {
    if (!session) return
    trpcClient.editorAi.status
      .query()
      .then((status) => setAvailable(status.backgrounds))
      .catch(() => setAvailable(false))
  }, [session, trpcClient])

  React.useEffect(() => {
    let active = true
    if (source === 'brand' && kit) {
      setPalette(
        [kit.colors.background, kit.accent, kit.colors.secondary, ...kit.colors.palette]
          .filter((color): color is string => Boolean(color))
          .slice(0, 6)
      )
    } else if (source === 'screenshot' && screenshot) {
      imagePalette(screenshot, 5)
        .then((colors) => active && setPalette(colors))
        .catch(() => active && setPalette([]))
    } else {
      setPalette([])
    }
    return () => {
      active = false
    }
  }, [kit, screenshot, source])

  if (!session || !available) return null

  async function apply(result: Result) {
    rememberUploadedSources({ [`asset:${result.assetId}`]: result.url })
    await applyDesignChanges(
      {
        background: {
          blur: 0,
          noise: 0,
          opacity: 1,
          type: 'image',
          value: `asset:${result.assetId}`,
        },
      },
      (ref) => (ref === `asset:${result.assetId}` ? result.url : ref)
    )
  }

  async function generate() {
    const words = prompt.trim()
    if (words.length < 3) {
      toast.error('Describe the background first.')
      return
    }
    setPending(true)
    try {
      const aspect = canvas ? nearestAspect(canvas.canvasW, canvas.canvasH) : '16:9'
      const { assetId } = await trpcClient.editorAi.generateBackground.mutate({
        aspect,
        palette,
        prompt: words,
      })
      const result = { assetId, prompt: words, url: await fetchAssetUrl(trpcClient, assetId) }
      setResults((current) => [result, ...current])
      await apply(result)
      toast.success('Background applied', { description: 'Earlier results stay below. ⌘Z undoes.' })
    } catch (error) {
      toast.error('Could not generate a background', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionWrapper defaultOpen={false} title="AI background">
      <div className="space-y-2.5">
        <Textarea
          aria-label="Describe the background"
          className="w-full resize-none rounded-md border border-foreground/10 bg-transparent px-2.5 py-2 text-xs"
          maxLength={600}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Soft aurora over a dark sky, grainy and calm"
          rows={3}
          value={prompt}
        />
        <div aria-label="Colours" className="flex flex-wrap gap-1" role="radiogroup">
          {(
            [
              ['none', 'Any colours'],
              ['screenshot', 'From screenshot'],
              ['brand', kit ? `Brand: ${kit.name}` : 'Brand kit'],
            ] as const
          ).map(([value, label]) => (
            <Button variant="custom" size={null}
              aria-checked={source === value}
              className={cn(
                'h-6 rounded-md border px-2 text-[10px] disabled:opacity-40',
                source === value
                  ? 'border-foreground/30 bg-foreground text-background'
                  : 'border-foreground/15 text-muted-foreground'
              )}
              disabled={(value === 'brand' && !kit) || (value === 'screenshot' && !screenshot)}
              key={value}
              onClick={() => setSource(value)}
              role="radio"
              type="button"
            >
              {label}
            </Button>
          ))}
        </div>
        {palette.length ? (
          <div aria-label="Palette" className="flex gap-1">
            {palette.map((color) => (
              <span
                className="size-4 rounded-full border border-foreground/15"
                key={color}
                style={{ background: color }}
                title={color}
              />
            ))}
          </div>
        ) : null}
        <Button
          className="h-8 w-full text-xs"
          disabled={pending}
          onClick={() => void generate()}
          type="button"
        >
          {pending ? 'Generating…' : results.length ? 'Generate another' : 'Generate background'}
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Uses AI credits. Your screenshot is not sent; only the description and colours are.
        </p>
        {results.length ? (
          <ul aria-label="Generated backgrounds" className="grid grid-cols-3 gap-1.5">
            {results.map((result) => (
              <li key={result.assetId}>
                <Button variant="custom" size={null}
                  aria-label={`Use background: ${result.prompt}`}
                  className="aspect-video w-full overflow-hidden rounded border border-foreground/10 hover:border-foreground/40"
                  onClick={() => void apply(result)}
                  title={result.prompt}
                  type="button"
                >
                  {/* A workspace blob URL, not an optimisable asset. */}
                  <img alt="" className="h-full w-full object-cover" src={result.url} />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SectionWrapper>
  )
}
