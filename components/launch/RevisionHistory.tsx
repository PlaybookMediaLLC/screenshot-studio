import Link from 'next/link'
import { Group, Pill, type PillTone, Section } from '@/components/platform-ui'

export type RevisionItem = {
  comment: string
  createdAt: Date
  id: string
  /** The proposal's own label for its target: "Messaging", "X post", "Plan v2". */
  label: string
  status: 'APPLIED' | 'DISCARDED' | 'PROPOSED'
  summary: string
  targetKey: string | null
  targetType: string
}

const STATUS: Record<RevisionItem['status'], { label: string; tone: PillTone }> = {
  APPLIED: { label: 'Applied', tone: 'green' },
  DISCARDED: { label: 'Discarded', tone: 'gray' },
  PROPOSED: { label: 'Proposed', tone: 'yellow' },
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 minutes ago"; rendered on the server per request, so no hydration drift. */
function ago(date: Date): string {
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, 'hour')
  return RELATIVE.format(Math.round(hours / 24), 'day')
}

function target(campaignId: string, item: RevisionItem): { href: string; label: string } {
  const base = `/campaigns/${campaignId}`
  if (item.targetType === 'spec_section') {
    return { href: `${base}/spec#spec-${item.targetKey}`, label: `Spec · ${item.label}` }
  }
  if (item.targetType === 'plan') return { href: `${base}/plan`, label: item.label }
  if (item.targetType === 'post') return { href: `${base}/copy`, label: item.label }
  return { href: `${base}/assets`, label: item.label }
}

/** Recent "Revise with AI" requests: what was asked, of what, and the outcome. */
export function RevisionHistory({
  campaignId,
  revisions,
}: {
  campaignId: string
  revisions: RevisionItem[]
}) {
  return (
    <Section description="What reviewers asked the AI to change." title="AI revisions">
      {revisions.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.015] px-5 py-6 text-sm text-neutral-500 ring-1 ring-white/[0.06]">
          None yet. Use Revise with AI on a spec section, the plan, a post, or a design.
        </p>
      ) : (
        <Group>
          <ul className="divide-y divide-white/[0.07]">
            {revisions.map((item) => {
              const link = target(campaignId, item)
              return (
                <li className="flex flex-col gap-1.5 px-5 py-4" key={item.id}>
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      className="block h-5 truncate text-xs leading-5 font-medium text-neutral-400 hover:text-white"
                      href={link.href}
                    >
                      {link.label}
                    </Link>
                    <Pill tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Pill>
                  </div>
                  <p className="text-sm text-white">“{item.comment}”</p>
                  {item.summary ? (
                    <p className="text-xs leading-5 text-neutral-500">{item.summary}</p>
                  ) : null}
                  <p className="text-xs text-neutral-600">
                    <time dateTime={item.createdAt.toISOString()}>{ago(item.createdAt)}</time>
                  </p>
                </li>
              )
            })}
          </ul>
        </Group>
      )}
    </Section>
  )
}
