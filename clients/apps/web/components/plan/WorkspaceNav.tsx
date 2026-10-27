import Link from 'next/link'
import { publishLinks } from '@/lib/platform/navigation'

const ACTIVE = { plan: 'Calendar', analyze: 'Analyze' }

/** The Publish area navigation, shared with Drafts and Campaign deliveries. */
export function WorkspaceNav({ active }: { active: 'plan' | 'analyze' }) {
  return (
    <nav aria-label="Publish" className="flex flex-wrap gap-2 border-b p-3 text-sm">
      {publishLinks().map(({ href, label }) => (
        <Link
          className="rounded px-3 py-2 aria-[current=page]:bg-muted"
          aria-current={label === ACTIVE[active] ? 'page' : undefined}
          key={href}
          href={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
