import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown01Icon, ArrowRight01Icon, Menu01Icon } from 'hugeicons-react'
import { navGroupSchema, pagesInGroup, type NavGroup } from '@/lib/marketing/platform-pages'
import { cn } from '@/lib/utils'
import { CtaLink } from './CtaLink'
import { CONTAINER, MONO, MUTED } from './primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

const GROUP = navGroupSchema.enum

type MenuItem = { href: string; label: string; blurb: string }

const MENUS: { group: NavGroup; label: string; extra?: MenuItem[] }[] = [
  { group: GROUP.product, label: 'Product' },
  { group: GROUP.solutions, label: 'Solutions' },
  {
    group: GROUP.developers,
    label: 'Developers',
    extra: [
      { href: '/api-reference', label: 'API reference', blurb: 'Every operation, live' },
      { href: '/docs', label: 'API docs', blurb: 'Guides, auth, and errors' },
      { href: '/developers', label: 'Developer portal', blurb: 'Specs, quickstarts, source' },
    ],
  },
  { group: GROUP.company, label: 'Company' },
]

function menuItems(menu: (typeof MENUS)[number]): MenuItem[] {
  return [
    ...pagesInGroup(menu.group).map(({ page, path }) => ({
      href: path,
      label: page.label,
      blurb: page.blurb,
    })),
    ...(menu.extra ?? []),
  ]
}

/** Announcement bar and sticky navigation for every platform marketing page. */
export function LandingNav() {
  return (
    <>
      <Link
        className="group flex h-10 items-center justify-center gap-2 bg-[#141414] px-6 text-center text-[13px] text-white/85 transition-colors hover:text-white sm:text-sm"
        href="/design-partners"
      >
        <span className="truncate">
          Launch intelligence is in early access. Become a design partner
        </span>
        <ArrowRight01Icon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur-xl">
        <nav aria-label="Main" className={`${CONTAINER} flex h-16 items-center gap-4 sm:gap-8`}>
          <Link className="flex shrink-0 items-center gap-2.5" href="/landing">
            <Image alt="" className="size-7" height={28} priority src="/logo-mark.png" width={28} />
            <span className="text-[15px] font-medium tracking-[-0.02em] text-white">
              Shots
            </span>
          </Link>
          <ul className="hidden items-center gap-1 text-[15px] lg:flex">
            {MENUS.map((menu) => (
              <li className="group relative" key={menu.group}>
                <Button variant="custom" size={null}
                  aria-haspopup="true"
                  className="flex items-center gap-1 rounded-full px-3 py-2 text-white/55 transition-colors duration-150 hover:text-white group-focus-within:text-white"
                  type="button"
                >
                  {menu.label}
                  <ArrowDown01Icon
                    aria-hidden="true"
                    className="size-3.5 transition-transform duration-150 group-focus-within:rotate-180 group-hover:rotate-180"
                  />
                </Button>
                <div className="invisible absolute left-0 top-full pt-3 opacity-0 transition-[opacity,visibility] duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <ul className="grid w-[520px] grid-cols-2 gap-1 rounded-2xl border border-white/[0.08] bg-[#111] p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)]">
                    {menuItems(menu).map((item) => (
                      <li key={item.href}>
                        <Link
                          className="block rounded-xl px-3.5 py-3 transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:outline-none"
                          href={item.href}
                        >
                          <span className="block text-[15px] text-white">{item.label}</span>
                          <span className={cn('mt-0.5 block text-[13px]', MUTED)}>
                            {item.blurb}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
            <li>
              <Link
                className="rounded-full px-3 py-2 text-white/55 transition-colors duration-150 hover:text-white"
                href="/pricing"
              >
                Pricing
              </Link>
            </li>
          </ul>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <Link
              className="hidden text-[15px] text-white transition-colors hover:text-white/70 sm:block"
              href="/sign-in"
            >
              Sign in
            </Link>
            <CtaLink
              className="h-10 pl-4 pr-3 text-sm sm:pl-5 sm:pr-4 sm:text-[15px]"
              href="/sign-up"
              label="Get started"
              location="landing_nav"
            />
            <Popover>
              <PopoverTrigger asChild>
              <Button variant="custom" size={null}
                aria-label="Open menu"
                className="flex size-10 items-center justify-center rounded-full border border-white/10 text-white lg:hidden"
                type="button"
              >
                <Menu01Icon aria-hidden="true" className="size-5" />
              </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="max-h-[75vh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-[#111] p-2 shadow-2xl lg:hidden">
                {MENUS.map((menu) => (
                  <div
                    className="border-b border-white/[0.06] py-2 last:border-b-0"
                    key={menu.group}
                  >
                    <p
                      className={cn(
                        MONO,
                        'px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]',
                        MUTED
                      )}
                    >
                      {menu.label}
                    </p>
                    {menuItems(menu).map((item) => (
                      <Link
                        className="block rounded-lg px-3 py-2 text-[15px] text-white/80 hover:bg-white/[0.05] hover:text-white"
                        href={item.href}
                        key={item.href}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ))}
                <div className="border-t border-white/[0.06] pt-2">
                  {[
                    { href: '/pricing', label: 'Pricing' },
                    { href: '/sign-in', label: 'Sign in' },
                  ].map((link) => (
                    <Link
                      className="block rounded-lg px-3 py-2 text-[15px] text-white/80 hover:bg-white/[0.05] hover:text-white"
                      href={link.href}
                      key={link.href}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </nav>
      </header>
    </>
  )
}
