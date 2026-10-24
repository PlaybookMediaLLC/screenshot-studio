import Link from 'next/link'

/** Shared navigation between the existing authoring surface, Plan and Analyze. */
export function WorkspaceNav({ active }: { active: 'plan' | 'analyze' }) {
  return (
    <nav aria-label="Content workspace" className="flex gap-2 border-b p-3 text-sm">
      {[
        ['Write', '/write'],
        ['Plan', '/write/plan'],
        ['Analyze', '/write/analyze'],
      ].map(([name, href]) => (
        <Link
          className="rounded px-3 py-2 aria-[current=page]:bg-muted"
          aria-current={name.toLowerCase() === active ? 'page' : undefined}
          key={href}
          href={href}
        >
          {name}
        </Link>
      ))}
    </nav>
  )
}
