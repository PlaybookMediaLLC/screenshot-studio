'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { MUTED } from './primitives'
import { useHydratedReducedMotion } from './useHydratedReducedMotion'

/** Design commitments behind the platform, in place of testimonials. */
const PRINCIPLES = [
  {
    name: 'Safe tools',
    source: 'The marketing tools',
    quote: 'The model decides what to do. The application decides how it is done safely.',
  },
  {
    name: 'Human approval',
    source: 'Campaign approval',
    quote:
      'Approval is a server-side state machine. It is not a UI convention, not a boolean flag, and not something a tool call can skip.',
  },
  {
    name: 'Structured campaigns',
    source: 'Marketing objects',
    quote: 'The database is the source of truth for a campaign. A conversation is an input method.',
  },
  {
    name: 'Recipes first',
    source: 'The launch recipe',
    quote:
      'An agent that fails produces an unclear failure. A recipe that fails names its failing step.',
  },
] as const

const ADVANCE_MS = 7000

/** Polar-style quote card that cycles through the platform's design principles. */
export function Principles() {
  const reduce = useHydratedReducedMotion()
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduce || paused) return
    const timer = setTimeout(
      () => setActive((index) => (index + 1) % PRINCIPLES.length),
      ADVANCE_MS
    )
    return () => clearTimeout(timer)
  }, [active, paused, reduce])

  const principle = PRINCIPLES[active]
  return (
    <div
      className="bg-[#111] px-6 py-16 sm:px-16 sm:py-24"
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <figure className="mx-auto flex min-h-[220px] max-w-[760px] flex-col items-center justify-center text-center">
        <motion.blockquote
          animate={{ opacity: 1, y: 0 }}
          className="text-balance text-[24px] leading-[1.35] tracking-[-0.02em] text-white sm:text-[30px]"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          key={principle.quote}
          transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {principle.quote}
        </motion.blockquote>
        <figcaption className={cn('mt-8 text-sm', MUTED)}>{principle.source}</figcaption>
      </figure>
      <div className="mx-auto mt-16 grid max-w-[1024px] grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
        {PRINCIPLES.map((item, index) => (
          <button
            aria-pressed={index === active}
            className="group relative pt-5 text-left"
            key={item.name}
            onClick={() => setActive(index)}
            type="button"
          >
            <span className="absolute inset-x-0 top-0 h-px bg-[#212121]">
              {index === active ? (
                <motion.span
                  animate={{ scaleX: 1 }}
                  className="block h-px origin-left bg-white"
                  initial={{ scaleX: reduce || paused ? 1 : 0 }}
                  key={`${active}-${paused}`}
                  transition={{
                    duration: reduce || paused ? 0 : ADVANCE_MS / 1000,
                    ease: 'linear',
                  }}
                />
              ) : null}
            </span>
            <span
              className={cn(
                'text-[15px] transition-colors',
                index === active ? 'text-white' : 'text-[#858585] group-hover:text-white/80'
              )}
            >
              {item.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
