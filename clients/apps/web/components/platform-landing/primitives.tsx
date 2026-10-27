import { useId, type ReactNode } from 'react'
import { CheckIcon as Tick02Icon } from '@phosphor-icons/react/dist/ssr/Check'
import { z } from 'zod'
import { cn } from '@/lib/utils'

/** Visual weight of a landing call to action. */
export const ctaToneSchema = z.enum(['primary', 'secondary'])

/** Visual weight of a landing call to action. */
export type CtaTone = z.infer<typeof ctaToneSchema>

/** Billing endpoints a checkout button can open. */
export const checkoutPathSchema = z.enum(['/api/billing/checkout', '/api/billing/credits'])

/** Page gutter and max width shared by every landing section. */
export const CONTAINER = 'mx-auto w-full max-w-[1280px] px-6 sm:px-10'

/** Geist Mono, used for labels, metadata, and code. */
export const MONO = 'font-[family-name:var(--font-geist-mono)]'

/** Tiled grayscale film grain, rasterized once by the browser. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Light direction and ripple angle for each stage variant, so adjacent stages differ. */
const STAGE_VARIANTS = [
  { light: '72% 18%', shadow: '18% 85%', angle: -14, offset: 0 },
  { light: '22% 22%', shadow: '82% 78%', angle: 11, offset: 40 },
  { light: '55% 90%', shadow: '40% 10%', angle: -24, offset: 90 },
  { light: '90% 60%', shadow: '10% 40%', angle: 6, offset: 140 },
] as const

/** Sand-ripple strokes: parallel cubic curves, masked so they fade in and out. */
function Ripples({ angle, offset }: { angle: number; offset: number }) {
  const id = useId()
  const lines = Array.from({ length: 52 }, (_, index) => {
    const y = -260 + index * 21 + offset
    return `M -200 ${y} C 260 ${y + 150}, 640 ${y - 190}, 1400 ${y + 110}`
  })
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
    >
      <defs>
        <radialGradient id={`${id}-fade`} cx="62%" cy="38%" r="62%">
          <stop offset="0" stopColor="white" stopOpacity="1" />
          <stop offset="0.55" stopColor="white" stopOpacity="0.55" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <rect width="1200" height="800" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} transform={`rotate(${angle} 600 400)`}>
        {lines.map((d, index) => (
          <path
            d={d}
            fill="none"
            key={d}
            stroke={index % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.38)'}
            strokeWidth={index % 2 ? 0.8 : 1.6}
          />
        ))}
      </g>
    </svg>
  )
}

/**
 * A grainy grayscale backdrop that product UI cards sit on, in the manner
 * of polar.sh. Pure CSS and inline SVG, no images.
 */
export function Stage({
  children,
  className,
  variant = 0,
}: {
  children: ReactNode
  className?: string
  variant?: number
}) {
  const { light, shadow, angle, offset } = STAGE_VARIANTS[variant % STAGE_VARIANTS.length]
  return (
    <div
      className={cn('relative isolate flex overflow-hidden rounded-[6px] bg-[#6b6b6b]', className)}
      style={{
        backgroundImage: `radial-gradient(60% 70% at ${light}, #e4e4e4 0%, #a9a9a9 38%, transparent 72%), radial-gradient(55% 60% at ${shadow}, #1c1c1c 0%, transparent 70%), linear-gradient(160deg, #8d8d8d, #4a4a4a)`,
      }}
    >
      <Ripples angle={angle} offset={offset} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] mix-blend-overlay"
        style={{ backgroundImage: GRAIN, backgroundSize: '180px 180px' }}
      />
      <div className="relative z-10 flex w-full min-w-0 items-center justify-center">
        {children}
      </div>
    </div>
  )
}

/** A dark product window floating on a stage. */
export function Window({
  children,
  className,
  meta,
  title,
}: {
  children: ReactNode
  className?: string
  meta?: ReactNode
  title: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[#1f1f1f] bg-[#090909] p-1 text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-4 px-3 pb-2.5 pt-2 text-[13px]">
        <span className="flex min-w-0 items-center gap-2 truncate text-white/85">{title}</span>
        {meta ? <span className="shrink-0 text-[#858585]">{meta}</span> : null}
      </div>
      <div className="rounded-xl bg-[#121212]">{children}</div>
    </div>
  )
}

/** Secondary text grey, used for the second half of every two-tone headline. */
export const MUTED = 'text-[#858585]'

/** A full-width page section with the hairline divider and 96px rhythm. */
export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section className={cn('scroll-mt-16', className)} id={id}>
      <div className={CONTAINER}>
        <div className="border-t border-[#212121] py-24 sm:py-32">{children}</div>
      </div>
    </section>
  )
}

/** Polar-style section opener: a label on the left, a two-tone headline and body on the right. */
export function SectionIntro({
  body,
  children,
  label,
  lead,
  trail,
}: {
  body?: ReactNode
  children?: ReactNode
  label: string
  lead: string
  trail: string
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-8">
      <p className="text-[26px] leading-[1.3] tracking-[-0.02em] text-white sm:text-[30px]">
        {label}
      </p>
      <div>
        <h2 className="text-balance text-[26px] leading-[1.35] tracking-[-0.02em] sm:text-[30px]">
          <span className="block text-white">{lead}</span>
          <span className={cn('block', MUTED)}>{trail}</span>
        </h2>
        {body ? (
          <p
            className={cn(
              'mt-10 max-w-[632px] text-xl leading-[1.4] tracking-[-0.01em] sm:mt-14 sm:text-2xl',
              MUTED
            )}
          >
            {body}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/** A small rounded tag, inverted (white on black) for emphasis as in sim.ai's node chips. */
export function Tag({ children, invert = false }: { children: ReactNode; invert?: boolean }) {
  return (
    <span
      className={cn(
        MONO,
        'inline-flex h-5 shrink-0 items-center rounded-[5px] px-1.5 text-[10.5px] uppercase tracking-[0.04em]',
        invert ? 'bg-white text-black' : 'bg-white/[0.07] text-white/60'
      )}
    >
      {children}
    </span>
  )
}

/** A green tick in a soft circle, for checklists. */
export function Check({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300',
        className
      )}
    >
      <Tick02Icon className="size-3" />
    </span>
  )
}
