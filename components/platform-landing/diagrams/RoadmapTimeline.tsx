'use client'

import { motion } from 'motion/react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO, MUTED, Tag } from '../primitives'
import { CSS_EASE, TRANSITION } from './parts'
import { useDiagramStep } from './useDiagramStep'

/** Product generations, in order. */
export const generationSchema = z.enum(['V1', 'V2', 'V3', 'V4', 'V5'])

/** One product generation. */
export type Generation = z.infer<typeof generationSchema>

const GEN = generationSchema.enum

/** Mirrors GENERATIONS in pages/RoadmapPage.tsx, which does not export it. */
const GENERATIONS: { version: Generation; title: string }[] = [
  { version: GEN.V1, title: 'The editor plus AI creative generation' },
  { version: GEN.V2, title: 'URL to campaign' },
  { version: GEN.V3, title: 'Product changes to campaigns, automatically' },
  { version: GEN.V4, title: 'Campaign, publish, performance, next campaign' },
  { version: GEN.V5, title: 'Marketing intelligence across GitHub, website, and analytics' },
]

/**
 * Inferred from the roadmap columns: the editor and launch intelligence are
 * Shipped, while "Paste a URL, get a profile" (V2) is still Next.
 */
const CURRENT: Generation = GEN.V1

/**
 * The five product generations as a timeline, with the current one marked.
 * Horizontal from `md`, vertical below it.
 */
export function RoadmapTimeline() {
  const { ref, step } = useDiagramStep<HTMLOListElement>(GENERATIONS.length + 1, 450)
  const marked = step >= GENERATIONS.length

  return (
    <ol
      aria-label={`Five generations: ${GENERATIONS.map((g) => `${g.version}, ${g.title}`).join('; ')}. ${CURRENT} is current.`}
      className="grid gap-8 md:grid-cols-5 md:gap-4"
      ref={ref}
      role="img"
    >
      {GENERATIONS.map(({ title, version }, index) => {
        const current = version === CURRENT
        const shown = index <= step
        return (
          <motion.li
            animate={{ opacity: shown ? 1 : 0.3, y: shown ? 0 : 6 }}
            className="relative pl-8 md:pl-0 md:pt-9"
            initial={false}
            key={version}
            transition={TRANSITION}
          >
            {index < GENERATIONS.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-[-32px] left-[5px] top-4 w-px md:bottom-auto md:left-4 md:right-[-16px] md:top-[5px] md:h-px md:w-auto',
                  current
                    ? 'bg-gradient-to-b from-emerald-400/60 to-white/10 md:bg-gradient-to-r'
                    : 'bg-white/10'
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-1 size-[11px] rounded-full border transition-[background-color,border-color,box-shadow] md:top-0',
                CSS_EASE,
                current && marked
                  ? 'border-emerald-400 bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]'
                  : current
                    ? 'border-emerald-400 bg-[#090909]'
                    : 'border-white/25 bg-[#090909]'
              )}
            />
            <div className="flex items-center gap-2">
              <span className={cn(MONO, 'text-[13px] text-white')}>{version}</span>
              {current ? (
                <span
                  className={cn(
                    'transition-opacity',
                    CSS_EASE,
                    marked ? 'opacity-100' : 'opacity-0'
                  )}
                >
                  <Tag invert>Current</Tag>
                </span>
              ) : null}
            </div>
            <p
              className={cn(
                'mt-2 text-[14px] leading-[1.5] md:mt-4',
                current ? 'text-white/85' : MUTED
              )}
            >
              {title}
            </p>
          </motion.li>
        )
      })}
    </ol>
  )
}
