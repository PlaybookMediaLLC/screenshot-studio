import { ArrowUpRightIcon as ArrowUpRight } from '@phosphor-icons/react/dist/ssr/ArrowUpRight'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'

export function ResourceCards({
  items,
}: {
  items: { title: string; description: string; href: string; scope: string }[]
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.title}>
          <SidebarLink
            className="group flex h-full flex-col gap-4 rounded-xl border border-border p-5 transition-colors hover:bg-muted/50"
            href={item.href}
          >
            <span className="flex items-start justify-between gap-4 font-medium">
              {item.title}
              <ArrowUpRight
                size={18}
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              />
            </span>
            <span className="flex-1 text-sm text-muted-foreground">{item.description}</span>
            <span className="text-xs text-muted-foreground">{item.scope}</span>
          </SidebarLink>
        </li>
      ))}
    </ul>
  )
}

export const BRAND_RESOURCES = [
  {
    title: 'Visual brand kits',
    description:
      'Manage and publish versioned colors, typography and visual rules. Existing approved work keeps its pinned version.',
    href: '/workspace/brand-kit',
    scope: 'Workspace · Versioned visual kit',
  },
  {
    title: 'Brand voice',
    description:
      'Workspace writing defaults and prohibited terms. Publishing brand overrides and draft instructions retain their existing inheritance.',
    href: '/workspace/brand-kit',
    scope: 'Workspace · Brand voice',
  },
  {
    title: 'Products',
    description: 'Manage product facts that inform briefs and content.',
    href: '/workspace/product',
    scope: 'Workspace · Product context',
  },
  {
    title: 'Product pages',
    description: 'Keep product page sources available for evidence and reusable context.',
    href: '/workspace/product-pages',
    scope: 'Workspace · Product sources',
  },
  {
    title: 'Publishing brands',
    description: 'Choose publishing identities, connected channels and their defaults.',
    href: '/workspace/social-sets',
    scope: 'Publishing brand · Delivery configuration',
  },
]
