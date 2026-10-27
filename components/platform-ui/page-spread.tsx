import type { CSSProperties, ReactNode } from 'react'
import { AddIcon } from '@/components/platform-shell/icons'
import { cn } from '@/lib/utils'

/**
 * Multi-page work drawn like a contact sheet: each page at its own shape on
 * the landing page's grain stage, numbered beneath, with a slot where the
 * next page goes. Pages spread a little and lift in turn when the card is
 * hovered (see platform-home.css). Decorative; the card's text names it.
 */

const RATIOS = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 } as const

/** A page's shape. */
export type PageRatio = keyof typeof RATIOS

/** What a miniature page shows. */
export type PageKind =
  | 'blank'
  | 'hero'
  | 'screen'
  | 'phone'
  | 'quote'
  | 'swatches'
  | 'type'
  | 'chart'
  | 'cta'
  | 'doc'
  | 'logo'
  | 'product'
  | 'web'
  | 'profile'

/** One page of a spread. */
export type SpreadPage = { kind: PageKind; ratio?: PageRatio }

const LIGHT = 'bg-[#f4f4f2] text-[#111] ring-black/10'
const DARK = 'bg-[#0b0b0b] text-white ring-white/15'
const DARK_KINDS = new Set<PageKind>(['hero', 'phone', 'chart', 'cta', 'profile'])
/** Lit from one corner, like the stage itself. */
const IMAGE =
  'bg-[radial-gradient(80%_90%_at_28%_18%,#e6e6e6,#8f8f8f_48%,#2a2a2a)] ring-1 ring-black/5'

/** A text line, sized against the page's width. */
function Bar({
  width,
  className,
  height = 4.5,
}: {
  width: string
  className?: string
  height?: number
}) {
  return (
    <span
      className={cn('block shrink-0 rounded-full bg-current', className)}
      style={{ width, height: `${height}cqw` }}
    />
  )
}

function Content({ kind, wide }: { kind: PageKind; wide: boolean }): ReactNode {
  switch (kind) {
    case 'blank':
      return null
    case 'hero':
      // Wide pages put the picture beside the headline; tall ones beneath it.
      return wide ? (
        <span className="flex size-full gap-[5cqw] p-[6cqw]">
          <span className="flex flex-1 flex-col justify-center gap-[3cqw]">
            <Bar width="92%" height={5} />
            <Bar width="66%" height={5} />
            <span className="mt-[2cqw] block h-[6cqw] w-[44%] rounded-full bg-white/85" />
          </span>
          <span className={cn('block w-[42%] rounded-[2.5cqw]', IMAGE)} />
        </span>
      ) : (
        <span className="flex size-full flex-col gap-[4cqw] p-[9cqw]">
          <Bar width="72%" height={7} />
          <Bar width="48%" height={7} />
          <span className="mt-[2cqw] block h-[8cqw] w-[30%] rounded-full bg-white/85" />
          <span className={cn('mt-auto block min-h-0 flex-1 rounded-[3cqw]', IMAGE)} />
        </span>
      )
    case 'screen':
      return (
        <span className="flex size-full p-[8cqw]">
          <span className="flex w-full flex-col overflow-hidden rounded-[3cqw] bg-white ring-1 ring-black/10">
            <span className="flex gap-[1.5cqw] border-b border-black/10 px-[3cqw] py-[2.5cqw]">
              {[0, 1, 2].map((dot) => (
                <span className="size-[2.5cqw] rounded-full bg-black/20" key={dot} />
              ))}
            </span>
            <span className="flex flex-1 flex-col gap-[3cqw] p-[5cqw] opacity-80">
              <Bar width="58%" height={5} />
              <Bar width="80%" className="opacity-25" height={3} />
              <span className={cn('mt-auto block h-[38%] rounded-[2cqw]', IMAGE)} />
            </span>
          </span>
        </span>
      )
    case 'phone':
      return (
        <span className="grid size-full place-items-center">
          <span className="flex aspect-[9/19] h-[84%] flex-col gap-[6%] rounded-[18%/8.5%] bg-[#1a1a1a] p-[7%] ring-1 ring-white/25">
            <span className="mx-auto block h-[3%] w-[34%] rounded-full bg-black" />
            <span className="block h-[38%] rounded-[10%] bg-[radial-gradient(90%_80%_at_30%_20%,#d4d4d4,#5a5a5a_60%,#1a1a1a)]" />
            <span className="block h-[4%] w-[70%] rounded-full bg-white/70" />
            <span className="block h-[4%] w-[45%] rounded-full bg-white/30" />
          </span>
        </span>
      )
    case 'quote':
      return (
        <span className="flex size-full flex-col gap-[4cqw] p-[10cqw]">
          <span className="font-serif text-[30cqw] leading-[0.6] text-black/80">“</span>
          <Bar width="86%" />
          <Bar width="64%" />
          <span className="mt-auto flex items-center gap-[3cqw]">
            <span className="size-[9cqw] rounded-full bg-[radial-gradient(circle_at_30%_30%,#bdbdbd,#3a3a3a)]" />
            <Bar width="34%" className="opacity-40" height={3.5} />
          </span>
        </span>
      )
    case 'swatches':
      return (
        <span className="flex size-full flex-col justify-between p-[10cqw]">
          <span className="grid grid-cols-2 gap-[5cqw]">
            {['#111111', '#4a4a4a', '#9a9a9a', '#d9d9d9'].map((color) => (
              <span
                className="aspect-square rounded-full ring-1 ring-black/10"
                key={color}
                style={{ background: color } as CSSProperties}
              />
            ))}
          </span>
          <Bar width="52%" className="opacity-40" height={3.5} />
        </span>
      )
    case 'type':
      return (
        <span className="flex size-full flex-col justify-between p-[10cqw]">
          <span className="text-[34cqw] leading-none font-medium tracking-[-0.04em]">Aa</span>
          <span className="grid gap-[3cqw]">
            <Bar width="70%" height={5} />
            <Bar width="88%" className="opacity-30" height={3} />
            <Bar width="62%" className="opacity-30" height={3} />
          </span>
        </span>
      )
    case 'chart':
      return (
        <span className="flex size-full flex-col p-[10cqw]">
          <Bar width="46%" className="opacity-80" height={4.5} />
          <span className="mt-auto flex h-[58%] items-end gap-[5%] border-b border-white/25">
            {[34, 52, 44, 72, 92].map((height, index) => (
              <span
                className={cn(
                  'flex-1 rounded-t-[1.5cqw]',
                  index === 4 ? 'bg-white' : 'bg-white/35'
                )}
                key={index}
                style={{ height: `${height}%` }}
              />
            ))}
          </span>
        </span>
      )
    case 'cta':
      return (
        <span className="flex size-full flex-col items-center justify-center gap-[5cqw] p-[10cqw]">
          <Bar width="68%" height={6.5} />
          <Bar width="44%" className="opacity-40" height={4} />
          <span className="mt-[3cqw] block h-[10cqw] w-[42%] rounded-full bg-white" />
        </span>
      )
    case 'doc':
      return (
        <span className="flex size-full flex-col gap-[3.5cqw] p-[10cqw]">
          <Bar width="60%" height={6} />
          {['92%', '84%', '88%', '52%'].map((width, index) => (
            <Bar width={width} className="opacity-25" height={3} key={index} />
          ))}
          <span className="mt-auto grid gap-[3cqw]">
            {[true, false].map((good) => (
              <span className="flex items-center gap-[3cqw]" key={String(good)}>
                <span
                  className={cn(
                    'grid size-[7cqw] place-items-center rounded-full text-[5cqw] leading-none text-white',
                    good ? 'bg-[#111]' : 'bg-black/30'
                  )}
                >
                  {good ? '✓' : '×'}
                </span>
                <Bar width="48%" className="opacity-40" height={3} />
              </span>
            ))}
          </span>
        </span>
      )
    case 'logo':
      return (
        <span className="grid size-full place-items-center">
          <span className="flex">
            <span className="size-[26cqw] rounded-full bg-[#111]" />
            <span className="-ml-[10cqw] size-[26cqw] rounded-full bg-[#9a9a9a] mix-blend-multiply" />
          </span>
        </span>
      )
    case 'product':
      return (
        <span className="flex size-full flex-col gap-[4cqw] p-[8cqw]">
          <span className={cn('block min-h-0 flex-1 rounded-[3cqw]', IMAGE)} />
          <Bar width="62%" height={5} />
          <span className="flex items-center justify-between">
            <Bar width="36%" className="opacity-30" height={3.5} />
            <span className="block h-[8cqw] w-[26%] rounded-full bg-[#111]" />
          </span>
        </span>
      )
    case 'web':
      return (
        <span className="flex size-full flex-col gap-[4cqw] p-[7cqw]">
          <span className="flex items-center gap-[3cqw]">
            <span className="size-[4cqw] rounded-full bg-[#111]" />
            <Bar width="12%" className="ml-auto opacity-30" height={2.5} />
            <Bar width="12%" className="opacity-30" height={2.5} />
            <Bar width="12%" className="opacity-30" height={2.5} />
          </span>
          <span className="mx-auto mt-[2cqw] grid w-full justify-items-center gap-[2.5cqw]">
            <Bar width="58%" height={5.5} />
            <Bar width="38%" className="opacity-30" height={3} />
          </span>
          <span className="mt-auto grid grid-cols-3 gap-[3cqw]">
            {[0, 1, 2].map((column) => (
              <span className={cn('aspect-[4/3] rounded-[2cqw]', IMAGE)} key={column} />
            ))}
          </span>
        </span>
      )
    case 'profile':
      return (
        <span className="flex size-full flex-col items-center justify-center gap-[4cqw] p-[10cqw]">
          <span className="size-[30cqw] rounded-full bg-[radial-gradient(circle_at_32%_28%,#e4e4e4,#6b6b6b_55%,#1c1c1c)] ring-1 ring-white/20" />
          <Bar width="56%" height={5} />
          <Bar width="36%" className="opacity-40" height={3.5} />
          <span className="mt-[2cqw] flex gap-[3cqw]">
            {[0, 1, 2].map((channel) => (
              <span className="size-[6cqw] rounded-full bg-white/30" key={channel} />
            ))}
          </span>
        </span>
      )
  }
}

/** A single miniature page, for use outside a spread. */
export function MiniPage({
  kind,
  ratio = '4:5',
  className,
}: {
  kind: PageKind
  ratio?: PageRatio
  className?: string
}) {
  return (
    <span
      className={cn(
        'page-spread-page relative block overflow-hidden rounded-[5px] ring-1 [container-type:inline-size]',
        DARK_KINDS.has(kind) ? DARK : LIGHT,
        className
      )}
      style={{ aspectRatio: RATIOS[ratio] }}
    >
      <Content kind={kind} wide={RATIOS[ratio] > 1.2} />
    </span>
  )
}

/**
 * Pages as a fanned deck on a frame of the given aspect ratio (the 4:3
 * gallery shot by default). At rest the deck sits loose, so every page's edge
 * and shape shows; hovering the card fans it out like a hand of cards, with
 * page numbers, and the page under the pointer comes to the front. A glass
 * card at the back marks where the next page goes. See platform-home.css.
 */
export function PageSpread({
  pages,
  add = false,
  frame = 4 / 3,
  numbered,
  className,
}: {
  pages: SpreadPage[]
  /** Put a card for the next page at the back of the deck. */
  add?: boolean
  frame?: number
  /** Number the pages; by default when there is more than one, or a slot. Off for a collection. */
  numbered?: boolean
  className?: string
}) {
  const count = pages.length + (add ? 1 : 0)
  const showNumbers = numbered ?? count > 1
  const mid = (count - 1) / 2
  const ratios = pages.map((page) => RATIOS[page.ratio ?? '4:5'])
  if (add) ratios.push(ratios[ratios.length - 1] ?? 1)
  // Pages share one height (half the frame), shrunk when a long deck of wide
  // pages would leave too little room to fan; widths are % of the frame width.
  const base = ratios.map((ratio) => (50 / frame) * ratio)
  const widest = Math.max(...base)
  const scale = Math.min(1, Math.max(0.55, (90 - 10 * (count - 1)) / widest))
  const widths = base.map((width) => width * scale)
  // How far apart page centres sit when fanned, in % of the frame width.
  const step = count > 1 ? Math.min(24, (92 - Math.max(...widths)) / (count - 1)) : 0
  const card = (index: number, children: ReactNode) => (
    <span
      className="deck-card"
      key={index}
      style={
        {
          width: `${widths[index]}%`,
          '--i': index,
          '--arc': Math.abs(index - mid),
        } as CSSProperties
      }
    >
      {children}
      {showNumbers && index < pages.length ? (
        <span className="deck-number page-spread-number">{index + 1}</span>
      ) : null}
    </span>
  )
  return (
    <span
      aria-hidden="true"
      className={cn('page-deck', className)}
      style={{ aspectRatio: frame, '--mid': mid, '--step': step } as CSSProperties}
    >
      {pages.map((page, index) =>
        card(index, <MiniPage className="w-full" kind={page.kind} ratio={page.ratio} />)
      )}
      {add
        ? card(
            pages.length,
            <span
              className="page-spread-add grid w-full place-items-center rounded-[5px]"
              style={{ aspectRatio: ratios[pages.length] }}
            >
              <AddIcon className="size-[28%] max-w-6" />
            </span>
          )
        : null}
      {showNumbers ? (
        <span className="deck-count">
          {pages.length} page{pages.length === 1 ? '' : 's'}
        </span>
      ) : null}
    </span>
  )
}
