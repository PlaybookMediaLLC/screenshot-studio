import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight01Icon } from 'hugeicons-react'
import { navGroupSchema, pagesInGroup, type NavGroup } from '@/lib/marketing/platform-pages'
import { cn } from '@/lib/utils'
import { GITHUB_URL } from './LandingNav'
import { CONTAINER, MUTED } from './primitives'

const fromRegistry = (group: NavGroup) =>
  pagesInGroup(group).map(({ page, path }) => ({ href: path, label: page.label }))

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [...fromRegistry(navGroupSchema.enum.product), { href: '/pricing', label: 'Pricing' }],
  },
  { title: 'Solutions', links: fromRegistry(navGroupSchema.enum.solutions) },
  {
    title: 'Developers',
    links: [
      ...fromRegistry(navGroupSchema.enum.developers),
      { href: '/api-reference', label: 'API reference' },
      { href: '/docs', label: 'API docs' },
      { href: '/developers', label: 'Developer portal' },
      { href: '/openapi.json', label: 'OpenAPI spec' },
      { href: '/llms.txt', label: 'llms.txt' },
    ],
  },
  {
    title: 'Editor',
    links: [
      { href: '/free-screenshot-editor', label: 'Screenshot editor' },
      { href: '/mockup-generator', label: 'Mockup generator' },
      { href: '/store-screenshots', label: 'App Store screenshots' },
      { href: '/code', label: 'Code to image' },
      { href: '/tweet', label: 'Tweet to image' },
      { href: '/tools', label: 'Image tools' },
      { href: '/guides', label: 'Guides' },
      { href: '/compare', label: 'Compare' },
    ],
  },
  {
    title: 'Company',
    links: [
      ...fromRegistry(navGroupSchema.enum.company),
      { href: '/changelog', label: 'Changelog' },
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: GITHUB_URL, label: 'GitHub' },
      { href: 'https://x.com/screenshotstdio', label: 'X' },
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
]

/** Polar-style link columns over a sim-style oversized wordmark. */
export function LandingFooter() {
  return (
    <footer className="overflow-hidden">
      <div className={CONTAINER}>
        <div className="grid gap-16 border-t border-[#212121] py-24 lg:grid-cols-[1fr_2fr]">
          <div className="flex flex-col justify-between gap-10">
            <Link className="flex items-center gap-3" href="/landing">
              <Image alt="" className="size-9" height={36} src="/logo-mark.png" width={36} />
              <span className="text-2xl tracking-[-0.03em] text-white">Screenshot Studio</span>
            </Link>
            <div className="space-y-6">
              <Link
                className="inline-flex items-center gap-1.5 border-b border-white pb-1 text-base text-white"
                href="/sign-up"
              >
                Get started
                <ArrowUpRight01Icon aria-hidden="true" className="size-4" />
              </Link>
              <p className={cn('text-[15px]', MUTED)}>
                © {new Date().getFullYear()} Screenshot Studio. Built on the open-source editor by
                Kartik Labhshetwar.
              </p>
            </div>
          </div>
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-5"
          >
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <p className={cn('text-[15px]', MUTED)}>{column.title}</p>
                <ul className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        className="text-[15px] text-white transition-colors hover:text-white/65"
                        href={link.href}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>
      <p
        aria-hidden="true"
        className="select-none whitespace-nowrap bg-gradient-to-b from-white/[0.14] to-transparent bg-clip-text pb-2 text-center text-[13.5vw] leading-[0.8] tracking-[-0.06em] text-transparent"
      >
        Screenshot Studio
      </p>
    </footer>
  )
}
