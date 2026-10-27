import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRightIcon as ArrowRight01Icon } from '@phosphor-icons/react/dist/ssr/ArrowRight'
import { ArrowUpRightIcon as ArrowUpRight01Icon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight'
import { XIcon as Cancel01Icon } from '@phosphor-icons/react/dist/ssr/X'
import { z } from 'zod'
import { PLATFORM_PAGES, type PlatformPagePath } from '@/lib/marketing/platform-pages'
import { cn } from '@/lib/utils'
import { CtaLink } from './CtaLink'
import { LandingFooter } from './LandingFooter'
import { LandingNav } from './LandingNav'
import { Check, CONTAINER, ctaToneSchema, MONO, MUTED, Section, Stage } from './primitives'
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'

/** A UI icon component. */
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** A call to action rendered as a pill link. */
export type Cta = { href: string; label: string }

/** Page chrome for every platform marketing page: nav, closing call to action, footer. */
export function MarketingShell({
  children,
  finale,
}: {
  children: ReactNode
  finale?: { lead: string; trail: string }
}) {
  return (
    <div className="min-h-screen bg-[#090909] font-[family-name:var(--font-geist-sans)] text-white antialiased">
      <LandingNav />
      <main>
        {children}
        <FinalCta lead={finale?.lead} trail={finale?.trail} />
      </main>
      <LandingFooter />
    </div>
  )
}

/** Sim-style split hero: two-tone headline left, body and calls to action right, visual below. */
export function PageHero({
  body,
  children,
  eyebrow,
  lead,
  location,
  primary = { href: '/sign-up', label: 'Get started' },
  secondary = { href: '/contact', label: 'Request a demo' },
  trail,
}: {
  body: ReactNode
  children?: ReactNode
  eyebrow: { label: string; href?: string; parent?: string }
  lead: string
  location: string
  primary?: Cta
  secondary?: Cta | null
  trail: string
}) {
  return (
    <section className={cn(CONTAINER, 'pb-24 pt-16 sm:pb-32 sm:pt-24')}>
      <p
        className={cn(
          MONO,
          'flex items-center gap-2 text-[12px] uppercase tracking-[0.08em]',
          MUTED
        )}
      >
        {eyebrow.parent && eyebrow.href ? (
          <>
            <Link
              className="inline-flex items-center transition-colors hover:text-white"
              href={eyebrow.href}
            >
              {eyebrow.parent}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <span className="text-white">{eyebrow.label}</span>
      </p>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-16">
        <h1 className="text-balance text-[40px] leading-[1] tracking-[-0.035em] sm:text-[56px] lg:text-[64px]">
          <span className="block text-white">{lead}</span>
          <span className={cn('block', MUTED)}>{trail}</span>
        </h1>
        <div className="lg:pb-2">
          <p className="max-w-[46ch] text-lg leading-[1.5] text-white/65">{body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CtaLink href={primary.href} label={primary.label} location={location} />
            {secondary ? (
              <CtaLink
                href={secondary.href}
                label={secondary.label}
                location={location}
                tone={ctaToneSchema.enum.secondary}
              />
            ) : null}
          </div>
        </div>
      </div>
      {children ? <div className="mt-16 sm:mt-20">{children}</div> : null}
    </section>
  )
}

/** A stage holding one centered product window, the default hero visual. */
export function HeroStage({ children, variant = 0 }: { children: ReactNode; variant?: number }) {
  return (
    <Stage className="items-center px-4 py-12 sm:px-12 sm:py-20" variant={variant}>
      {children}
    </Stage>
  )
}

/** Polar-style flat tiles: an optional mono snippet or icon, a title, and one paragraph. */
export function TileGrid({
  columns = 3,
  items,
}: {
  columns?: 2 | 3
  items: { title: string; body: ReactNode; snippet?: string; icon?: Icon }[]
}) {
  return (
    <ul
      className={cn(
        'grid gap-4 sm:grid-cols-2',
        columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
      )}
    >
      {items.map(({ body, icon: ItemIcon, snippet, title }) => (
        <li className="flex flex-col bg-[#111] p-8 sm:p-10" key={title}>
          {snippet ? (
            <code className={cn(MONO, 'truncate text-[12px] text-white/50')}>{snippet}</code>
          ) : null}
          {ItemIcon ? (
            <ItemIcon aria-hidden={true} className="size-5 text-white/80" />
          ) : null}
          <h3
            className={cn(
              'text-[22px] tracking-[-0.015em] text-white',
              snippet || ItemIcon ? 'mt-12' : null
            )}
          >
            {title}
          </h3>
          <div className={cn('mt-3 text-base leading-[1.6]', MUTED)}>{body}</div>
        </li>
      ))}
    </ul>
  )
}

/** Sim-style capability grid: cells divided by 1px lines, each with an icon, title, and line. */
export function ControlGrid({
  items,
}: {
  items: { icon: Icon; title: string; body: ReactNode }[]
}) {
  return (
    <ul className="grid gap-px overflow-hidden rounded-xl border border-[#212121] bg-[#212121] sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ body, icon: ItemIcon, title }) => (
        <li className="bg-[#090909] p-7" key={title}>
          <ItemIcon aria-hidden={true} className="size-5 text-white/80" />
          <h3 className="mt-6 text-base text-white">{title}</h3>
          <p className={cn('mt-1.5 text-[15px] leading-[1.55]', MUTED)}>{body}</p>
        </li>
      ))}
    </ul>
  )
}

/** A boolean or text cell in a comparison table. */
export function Mark({ value }: { value: boolean | string }) {
  if (value === true) return <Check />
  if (value === false)
    return (
      <span className="inline-flex size-5 items-center justify-center text-white/25">
        <Cancel01Icon aria-label="Not included" className="size-3.5" />
      </span>
    )
  return <span className="text-white/85">{value}</span>
}

/** A hairline table. The first column is the row label; the rest are values. */
export function RowTable({
  caption,
  head,
  monoLabels = false,
  rows,
}: {
  caption?: string
  head?: ReactNode[]
  monoLabels?: boolean
  rows: { label: ReactNode; cells: ReactNode[] }[]
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
        {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
        {head ? (
          <TableHeader>
            <TableRow className="border-b border-[#212121]">
              {head.map((cell, index) => (
                <TableHead
                  className={`whitespace-normal ${cn('py-4 pr-6 font-normal', MUTED, index === 0 ? 'w-[34%]' : null)}`}
                  key={index}
                  scope="col"
                >
                  {cell}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        ) : null}
        <TableBody>
          {rows.map((row, index) => (
            <TableRow className="border-b border-[#212121] align-top" key={index}>
              <TableHead
                className={`whitespace-normal ${cn(
                  'py-4 pr-6 font-normal text-white',
                  monoLabels && cn(MONO, 'text-[13px]')
                )}`}
                scope="row"
              >
                {row.label}
              </TableHead>
              {row.cells.map((cell, cellIndex) => (
                <TableCell className={`whitespace-normal ${cn('py-4 pr-6', MUTED)}`} key={cellIndex}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** A question and its answer. */
export type Faq = { q: string; a: ReactNode }

/** Independent FAQ disclosures with keyboard-accessible triggers. */
export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="border-t border-[#212121]">
      {items.map((faq) => (
        <Accordion type="single" collapsible key={faq.q}>
          <AccordionItem value="details" className="group border-b border-[#212121]">
            <AccordionTrigger className="[&>svg:last-child]:hidden flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-lg text-white [&::-webkit-details-marker]:hidden">
              {faq.q}
              <span
                aria-hidden="true"
                className="relative size-3.5 shrink-0 before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-white after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-white after:transition-transform group-data-[state=open]:after:scale-y-0"
              />
            </AccordionTrigger>
            <AccordionContent className="p-0">
              <div className={cn('max-w-[600px] pb-7 text-base leading-[1.65]', MUTED)}>
                {faq.a}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ))}
    </div>
  )
}

/** A full FAQ section: label on the left, questions on the right. */
export function FaqBlock({ items }: { items: Faq[] }) {
  return (
    <Section>
      <div className="grid gap-12 md:grid-cols-2 md:gap-8">
        <div>
          <p className="text-[26px] tracking-[-0.02em] text-white sm:text-[30px]">Questions</p>
          <p className={cn('mt-3 max-w-[360px] text-lg', MUTED)}>
            Anything else?{' '}
            <Link className="text-white underline-offset-4 hover:underline" href="/contact">
              Talk to us
            </Link>
            .
          </p>
        </div>
        <FaqList items={items} />
      </div>
    </Section>
  )
}

/** Cards linking to other platform pages, labelled from the registry. */
export function LinkCards({
  columns = 3,
  paths,
}: {
  columns?: 2 | 3 | 4
  paths: PlatformPagePath[]
}) {
  return (
    <ul
      className={cn(
        'grid gap-4 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        columns === 4 && 'lg:grid-cols-4'
      )}
    >
      {paths.map((path) => {
        const page = PLATFORM_PAGES[path]
        return (
          <li key={path}>
            <Link
              className="group flex h-full flex-col justify-between gap-12 bg-[#111] p-6 transition-colors hover:bg-[#161616]"
              href={path}
            >
              <ArrowUpRight01Icon
                aria-hidden="true"
                className="size-5 self-end text-[#858585] transition-colors group-hover:text-white"
              />
              <span>
                <span className="block text-lg text-white">{page.label}</span>
                <span className={cn('mt-1 block text-[15px] leading-[1.5]', MUTED)}>
                  {page.blurb}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Text beside a staged visual, alternating sides down the page. */
export function SplitFeature({
  body,
  bullets,
  children,
  index = 0,
  link,
  title,
}: {
  body: ReactNode
  bullets?: string[]
  children: ReactNode
  index?: number
  link?: Cta
  title: string
}) {
  const flip = index % 2 === 1
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn(flip && 'lg:order-2')}>
        <p className={cn(MONO, 'text-[13px]', MUTED)}>{String(index + 1).padStart(2, '0')}</p>
        <h3 className="mt-3 text-[28px] leading-[1.2] tracking-[-0.02em] text-white">{title}</h3>
        <div className={cn('mt-4 text-lg leading-[1.55]', MUTED)}>{body}</div>
        {bullets ? (
          <ul className="mt-8 space-y-3">
            {bullets.map((bullet) => (
              <li className="flex items-start gap-3 text-[15px] text-white/85" key={bullet}>
                <Check className="mt-0.5" />
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
        {link ? (
          <Link
            className="group mt-8 inline-flex items-center gap-1.5 text-[15px] text-white hover:text-white/75"
            href={link.href}
          >
            {link.label}
            <ArrowRight01Icon
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ) : null}
      </div>
      <Stage className="min-h-[340px] items-center px-5 py-10 sm:p-12" variant={index + 1}>
        <div className="w-full max-w-[460px]">{children}</div>
      </Stage>
    </div>
  )
}

/** Large figures on hairline rows, after sim.ai's proof block. */
export function StatRows({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <dl className="divide-y divide-[#212121] border-y border-[#212121]">
      {stats.map((stat) => (
        <div className="flex items-end justify-between gap-8 py-7" key={stat.label}>
          <dt className="sr-only">{stat.label}</dt>
          <dd className="text-[56px] leading-[0.95] tracking-[-0.045em] text-white sm:text-[76px]">
            {stat.value}
          </dd>
          <dd className={cn('max-w-[240px] pb-2 text-right text-base', MUTED)}>{stat.label}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Delivery state of a capability, integration, or roadmap item. */
export const availabilitySchema = z.enum(['Available', 'Early access', 'Planned'])

/** Delivery state of a capability, integration, or roadmap item. */
export type Availability = z.infer<typeof availabilitySchema>

const AVAILABILITY_TONE: Record<Availability, string> = {
  Available: 'bg-emerald-400/10 text-emerald-300',
  'Early access': 'bg-white/[0.08] text-white',
  Planned: 'bg-white/[0.04] text-[#858585]',
}

/** A small pill naming whether something ships today. */
export function AvailabilityPill({ status }: { status: Availability }) {
  return (
    <span
      className={cn(
        MONO,
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] uppercase tracking-[0.04em]',
        AVAILABILITY_TONE[status]
      )}
    >
      {status}
    </span>
  )
}

/** A centered pull quote, with an optional caption, for product rules. */
export function PullQuote({ quote, source }: { quote: string; source?: string }) {
  return (
    <figure className="bg-[#111] px-6 py-16 text-center sm:px-16 sm:py-20">
      <blockquote className="mx-auto max-w-[760px] text-balance text-[24px] leading-[1.35] tracking-[-0.02em] text-white sm:text-[30px]">
        {quote}
      </blockquote>
      {source ? <figcaption className={cn('mt-8 text-sm', MUTED)}>{source}</figcaption> : null}
    </figure>
  )
}

/** Closing call to action over a faded stage, after sim.ai's finale. */
export function FinalCta({
  lead = 'Shipping something this week?',
  trail = 'Have its launch ready for review the same day.',
}: {
  lead?: string
  trail?: string
}) {
  return (
    <section className={cn(CONTAINER, 'pb-24 sm:pb-32')}>
      <Stage variant={0}>
        <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(9,9,9,0.92),rgba(9,9,9,0.6)_60%,rgba(9,9,9,0.15))]" />
        <div className="relative w-full px-6 py-28 text-center sm:py-40">
          <h2 className="text-balance text-[40px] leading-[1.05] tracking-[-0.035em] sm:text-[64px]">
            <span className="block text-white">{lead}</span>
            <span className="block text-white/55">{trail}</span>
          </h2>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <CtaLink className="h-12" href="/sign-up" label="Get started" location="final_cta" />
            <CtaLink
              className="h-12 bg-black/40 backdrop-blur"
              href="/contact"
              label="Request a demo"
              location="final_cta"
              tone={ctaToneSchema.enum.secondary}
            />
          </div>
        </div>
      </Stage>
    </section>
  )
}

/** A text link with a trailing arrow. */
export function ArrowLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      className="group inline-flex items-center gap-1.5 text-[15px] text-white transition-colors hover:text-white/75"
      href={href}
    >
      {children}
      <ArrowRight01Icon
        aria-hidden="true"
        className="size-4 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  )
}
