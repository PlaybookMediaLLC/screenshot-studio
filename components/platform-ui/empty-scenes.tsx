import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PageSpread } from './page-spread'

/**
 * Small product scenes for empty states, drawn in the landing page's dark
 * window style so they sit on its grain stage in either theme. Decorative:
 * the empty state's own text says what to do.
 */

const PANEL =
  'rounded-xl border border-white/10 bg-[#101010] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.8)]'

function Line({ width, className }: { width: string; className?: string }) {
  return (
    <span className={cn('block h-1.5 rounded-full bg-white/15', className)} style={{ width }} />
  )
}

function Scene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('relative shrink-0 text-white', className)}>
      {children}
    </div>
  )
}

/** Home: the three kinds of work, a post, a visual and a campaign, fanned out. */
export function HomeScene() {
  return (
    <Scene className="h-44 w-72">
      <div className={cn(PANEL, 'absolute top-8 left-0 w-36 -rotate-6 p-3')}>
        <span className="flex items-center gap-2">
          <span className="size-4 rounded-full bg-white/25" />
          <Line width="45%" />
        </span>
        <span className="mt-3 grid gap-1.5">
          <Line width="100%" />
          <Line width="85%" />
          <Line width="60%" />
        </span>
      </div>
      <div className={cn(PANEL, 'absolute top-0 left-20 z-10 w-40 rotate-1 p-1.5')}>
        <span className="block h-24 rounded-lg bg-[radial-gradient(80%_90%_at_30%_20%,#d4d4d4,#5a5a5a_55%,#1a1a1a)]" />
        <span className="mt-2 block px-1.5 pb-1">
          <Line width="55%" />
        </span>
      </div>
      <div className={cn(PANEL, 'absolute top-14 right-0 w-32 rotate-6 p-3')}>
        <span className="text-[9px] tracking-wide text-white/50 uppercase">Campaign</span>
        <Line className="mt-2" width="80%" />
        <span className="mt-3 inline-block rounded-full border border-white/15 px-1.5 text-[9px] text-white/70">
          In review
        </span>
      </div>
    </Scene>
  )
}

/** Create: a screenshot being framed, with the editor's controls beside it. */
export function CreateScene() {
  return (
    <Scene className="w-72">
      <div className={cn(PANEL, 'p-3')}>
        <div className="rounded-lg bg-[linear-gradient(135deg,#8d8d8d,#3a3a3a_60%,#161616)] p-5">
          <div className="overflow-hidden rounded-md bg-[#0b0b0b] ring-1 ring-white/10">
            <div className="flex gap-1 border-b border-white/10 px-2 py-1.5">
              {[0, 1, 2].map((dot) => (
                <span className="size-1.5 rounded-full bg-white/25" key={dot} />
              ))}
            </div>
            <div className="grid gap-1.5 p-3">
              <Line width="50%" className="bg-white/30" />
              <Line width="80%" />
              <Line width="65%" />
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {['Frame', 'Shadow', 'Export'].map((label, index) => (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px]',
                index === 2 ? 'bg-white text-black' : 'border border-white/15 text-white/70'
              )}
              key={label}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </Scene>
  )
}

/** Campaigns: one release fanned out into a post per channel. */
export function CampaignsScene() {
  const channels = ['X thread', 'LinkedIn post', 'Launch email']
  return (
    <Scene className="flex w-80 items-center gap-4">
      <div className={cn(PANEL, 'w-32 p-3')}>
        <span className="text-[9px] tracking-wide text-white/50 uppercase">Release</span>
        <span className="mt-1 block text-sm">v2.4</span>
        <span className="mt-2 grid gap-1.5">
          <Line width="90%" />
          <Line width="70%" />
        </span>
      </div>
      <span className="h-px w-6 shrink-0 bg-white/25" />
      <div className="grid flex-1 gap-2">
        {channels.map((channel, index) => (
          <div className={cn(PANEL, 'flex items-center gap-2 px-2.5 py-2')} key={channel}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: ['#d4d4d4', '#8d8d8d', '#5a5a5a'][index] } as CSSProperties}
            />
            <span className="truncate text-[11px] text-white/80">{channel}</span>
          </div>
        ))}
      </div>
    </Scene>
  )
}

/** Automate: an event running through a workflow to review. */
export function AutomateScene() {
  const steps = [
    { label: 'Release published', tone: 'bg-emerald-400' },
    { label: 'Create campaign drafts', tone: 'bg-white/40' },
    { label: 'Submit for review', tone: 'bg-white/40' },
    { label: 'Ready to publish', tone: 'bg-white/70' },
  ]
  return (
    <Scene className="w-60">
      <ol className="grid">
        {steps.map((step, index) => (
          <li className="grid justify-items-center" key={step.label}>
            {index > 0 ? <span className="h-4 w-px bg-white/25" /> : null}
            <span className={cn(PANEL, 'flex w-full items-center gap-2 py-2 pr-3 pl-2')}>
              <span className={cn('h-4 w-0.5 rounded-full', step.tone)} />
              <span className="text-[11px] text-white/85">{step.label}</span>
            </span>
          </li>
        ))}
      </ol>
    </Scene>
  )
}

/** Library: everything a team makes, each piece at its own shape. */
export function LibraryScene() {
  return (
    <Scene className="w-96">
      <PageSpread
        frame={16 / 9}
        numbered={false}
        pages={[
          { kind: 'hero', ratio: '16:9' },
          { kind: 'phone', ratio: '9:16' },
          { kind: 'quote', ratio: '1:1' },
          { kind: 'swatches', ratio: '4:5' },
        ]}
      />
    </Scene>
  )
}
