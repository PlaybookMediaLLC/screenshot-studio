import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Page building blocks for the signed-in platform, after Polar's dashboard:
 * a page frame with a title and actions, titled sections, grouped rows with a
 * label on the left and a control on the right, status pills, and a roomy
 * empty state. Fork-owned so upstream editor files stay untouched.
 */

const PAGE_WIDTH = { md: 'max-w-3xl', sm: 'max-w-2xl', xl: 'max-w-7xl' } as const

export function Page({
  actions,
  children,
  description,
  title,
  width = 'xl',
}: {
  actions?: ReactNode
  children: ReactNode
  description?: ReactNode
  title: string
  width?: keyof typeof PAGE_WIDTH
}) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full flex-col gap-8 px-4 pt-8 pb-16 md:px-8',
        PAGE_WIDTH[width]
      )}
    >
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-tight text-white">{title}</h1>
          {description ? <p className="mt-1 text-sm text-neutral-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </main>
  )
}

export function Section({
  actions,
  children,
  description,
  id,
  title,
}: {
  actions?: ReactNode
  children: ReactNode
  description?: ReactNode
  id?: string
  title: string
}) {
  return (
    <section className="flex flex-col gap-4" id={id}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-white">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-balance text-neutral-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A rounded card of rows separated by hairlines. */
export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex w-full flex-col divide-y divide-white/[0.07] overflow-hidden rounded-2xl bg-white/[0.015] ring-1 ring-white/[0.08]',
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * One row in a Group. `split` puts the control beside the label from md up,
 * `inline` always does (for switches and buttons), `stacked` puts it below.
 */
export function Row({
  children,
  description,
  label,
  layout = 'split',
}: {
  children?: ReactNode
  description?: ReactNode
  label?: ReactNode
  layout?: 'inline' | 'split' | 'stacked'
}) {
  if (!label) return <div className="flex flex-col gap-4 p-5">{children}</div>
  return (
    <div
      className={cn(
        'flex gap-4 p-5',
        layout === 'inline' && 'flex-row items-center justify-between',
        layout === 'split' && 'flex-col md:flex-row md:items-center md:justify-between',
        layout === 'stacked' && 'flex-col'
      )}
    >
      <div className={cn('min-w-0', layout === 'split' && 'md:max-w-[50%]')}>
        <h3 className="text-sm font-medium text-white">{label}</h3>
        {description ? <p className="mt-0.5 text-xs text-neutral-500">{description}</p> : null}
      </div>
      {children ? (
        <div
          className={cn(
            'flex min-w-0 items-center gap-2',
            layout === 'split' && 'md:w-1/2 md:justify-end',
            layout === 'inline' && 'shrink-0'
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

const PILL_TONES = {
  blue: 'bg-blue-500/10 text-blue-300 ring-blue-500/20',
  gray: 'bg-white/[0.06] text-neutral-300 ring-white/10',
  green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
  purple: 'bg-violet-500/10 text-violet-300 ring-violet-500/20',
  red: 'bg-red-500/10 text-red-300 ring-red-500/20',
  yellow: 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
} as const

export type PillTone = keyof typeof PILL_TONES

export function Pill({ children, tone = 'gray' }: { children: ReactNode; tone?: PillTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        PILL_TONES[tone]
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode
  description: ReactNode
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
  title: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-2xl bg-white/[0.02] px-6 py-24 text-center ring-1 ring-white/[0.06] md:py-32">
      <Icon className="text-neutral-600" size={44} strokeWidth={1.4} />
      <div>
        <h3 className="text-lg font-medium text-white">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-neutral-500">{description}</p>
      </div>
      {action}
    </div>
  )
}
