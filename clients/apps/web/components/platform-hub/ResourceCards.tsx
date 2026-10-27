import { OutwardIcon as ArrowUpRight } from '@/components/platform-shell/icons'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { Stage, Window } from '@/components/platform-landing/primitives'
import { PageSpread, type SpreadPage } from '@/components/platform-ui/page-spread'

/**
 * Starting points as a studio gallery: each on the landing page's grain stage,
 * as the pages it makes or a small window naming it, then its name and where
 * it lives beneath.
 */
export function ResourceCards({
  items,
}: {
  items: {
    title: string
    description: string
    href: string
    scope: string
    /** The pages this starting point makes, drawn as a numbered spread. */
    pages?: SpreadPage[]
    /** Whether the spread shows a slot for another page. */
    add?: boolean
  }[]
}) {
  return (
    <ul className="studio-grid">
      {items.map((item, index) => (
        <li className="studio-shot" key={item.title}>
          <SidebarLink className="group block" href={item.href}>
            <span className="studio-shot-media">
              <Stage className="size-full rounded-none" variant={index}>
                {item.pages ? (
                  <PageSpread add={item.add} pages={item.pages} />
                ) : (
                  <Window
                    className="w-[80%] transition-transform duration-300 group-hover:-translate-y-1"
                    meta={<ArrowUpRight size={14} aria-hidden="true" />}
                    title={item.scope.split(' · ')[0]}
                  >
                    <span className="block px-4 py-5 text-start">
                      <span className="block text-[17px] leading-snug text-white">
                        {item.title}
                      </span>
                      <span className="mt-2 line-clamp-3 block text-xs leading-relaxed text-[#858585]">
                        {item.description}
                      </span>
                    </span>
                  </Window>
                )}
              </Stage>
            </span>
            <span className="studio-shot-meta">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.scope}</span>
              </span>
              <ArrowUpRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              />
            </span>
          </SidebarLink>
        </li>
      ))}
    </ul>
  )
}

export const BRAND_RESOURCES: Parameters<typeof ResourceCards>[0]['items'] = [
  {
    title: 'Visual brand kits',
    description:
      'Manage and publish versioned colors, typography and visual rules. Existing approved work keeps its pinned version.',
    href: '/workspace/brand-kit',
    scope: 'Workspace · Versioned visual kit',
    pages: [{ kind: 'logo' }, { kind: 'swatches' }, { kind: 'type' }],
  },
  {
    title: 'Brand voice',
    description:
      'Workspace writing defaults and prohibited terms. Publishing brand overrides and draft instructions retain their existing inheritance.',
    href: '/workspace/brand-kit',
    scope: 'Workspace · Brand voice',
    pages: [{ kind: 'doc' }, { kind: 'quote', ratio: '1:1' }],
  },
  {
    title: 'Products',
    description: 'Manage product facts that inform briefs and content.',
    href: '/workspace/product',
    scope: 'Workspace · Product context',
    pages: [{ kind: 'product' }, { kind: 'chart', ratio: '1:1' }],
    add: true,
  },
  {
    title: 'Product pages',
    description: 'Keep product page sources available for evidence and reusable context.',
    href: '/workspace/product-pages',
    scope: 'Workspace · Product sources',
    pages: [
      { kind: 'web', ratio: '4:3' },
      { kind: 'web', ratio: '4:3' },
    ],
    add: true,
  },
  {
    title: 'Publishing brands',
    description: 'Choose publishing identities, connected channels and their defaults.',
    href: '/workspace/social-sets',
    scope: 'Publishing brand · Delivery configuration',
    pages: [
      { kind: 'profile', ratio: '9:16' },
      { kind: 'hero', ratio: '1:1' },
      { kind: 'phone', ratio: '9:16' },
    ],
  },
]
