import { InstagramLogoIcon as InstagramIcon } from '@phosphor-icons/react/dist/ssr/InstagramLogo'
import { LinkedinLogoIcon as Linkedin01Icon } from '@phosphor-icons/react/dist/ssr/LinkedinLogo'
import { EnvelopeIcon as Mail01Icon } from '@phosphor-icons/react/dist/ssr/Envelope'
import { XLogoIcon as NewTwitterIcon } from '@phosphor-icons/react/dist/ssr/XLogo'
import { NoteIcon as Note01Icon } from '@phosphor-icons/react/dist/ssr/Note'
import { RocketIcon as Rocket01Icon } from '@phosphor-icons/react/dist/ssr/Rocket'
import { CHANNEL_RULES } from '@/lib/launch/guards'
import { LAUNCH_CHANNEL_LABELS, type LaunchChannel } from '@/lib/launch/spec-schema'
import { cn } from '@/lib/utils'
import { MONO, MUTED, Tag, Window } from './primitives'
import { CreativeMock } from './WorkflowSection'

const CHANNEL_ICONS: Record<LaunchChannel, typeof Mail01Icon> = {
  x: NewTwitterIcon,
  linkedin: Linkedin01Icon,
  instagram: InstagramIcon,
  product_hunt: Rocket01Icon,
  changelog: Note01Icon,
  email: Mail01Icon,
}

/**
 * A drafted post for one channel, with its length measured against the real
 * channel limit and the launch brief claims it cites.
 */
export function PostCard({
  body,
  channel,
  claims,
  image = false,
  title,
}: {
  body: string
  channel: LaunchChannel
  claims: string[]
  image?: boolean
  title?: string
}) {
  const Icon = CHANNEL_ICONS[channel]
  const rule = CHANNEL_RULES[channel]
  return (
    <Window
      className="w-full"
      meta={
        <span className={cn(MONO, 'text-[11.5px]')}>
          {body.length.toLocaleString('en-US')} / {rule.bodyMax.toLocaleString('en-US')}
        </span>
      }
      title={
        <>
          <Icon aria-hidden="true" className="size-4 text-white" />
          {LAUNCH_CHANNEL_LABELS[channel]}
        </>
      }
    >
      <div className="space-y-3 p-4">
        {title ? <p className="text-[14px] font-medium text-white">{title}</p> : null}
        <p className="whitespace-pre-line text-[13.5px] leading-[1.55] text-white/85">{body}</p>
        {image ? <CreativeMock className="aspect-[16/9]" /> : null}
        <div className="flex flex-wrap gap-1.5">
          {claims.map((claim) => (
            <Tag key={claim}>{claim}</Tag>
          ))}
        </div>
      </div>
    </Window>
  )
}

const WEEK = [
  { day: 'Mon', phase: 'Teaser', posts: ['X', 'LinkedIn'] },
  { day: 'Tue', phase: 'Launch day', posts: ['Product Hunt', 'X', 'Email', 'Changelog'] },
  { day: 'Wed', phase: 'Launch day', posts: ['LinkedIn', 'Instagram'] },
  { day: 'Thu', phase: 'Follow-up', posts: ['X'] },
  { day: 'Fri', phase: 'Follow-up', posts: ['LinkedIn'] },
]

/** A launch week laid out as teaser, launch day, and follow-up. */
export function WeekMock() {
  return (
    <Window
      className="w-full max-w-[880px]"
      meta={`${WEEK.flatMap((day) => day.posts).length} posts approved`}
      title="Launch week"
    >
      <div className="grid grid-cols-5 gap-px overflow-hidden rounded-xl bg-white/[0.06] text-[12px]">
        {WEEK.map(({ day, phase, posts }) => (
          <div className="min-h-[200px] bg-[#121212] p-3" key={day}>
            <p className="text-white">{day}</p>
            <p className={cn('mt-0.5 text-[11px]', MUTED)}>{phase}</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {posts.map((post) => (
                <span
                  className={cn(
                    'truncate rounded-md px-2 py-1',
                    phase === 'Launch day' ? 'bg-white text-black' : 'bg-white/[0.06] text-white/80'
                  )}
                  key={post}
                >
                  {post}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Window>
  )
}

/** A changelog entry as the AI drafts it. */
export function ChangelogMock() {
  return (
    <Window className="w-full" meta="changelog" title="Changelog entry">
      <div className="space-y-3 p-5">
        <p className={cn(MONO, 'text-[11px]', MUTED)}>v2.4.0 · Billing</p>
        <p className="text-lg tracking-[-0.01em] text-white">Recurring invoices</p>
        <p className="text-[13.5px] leading-[1.6] text-white/80">
          Set a schedule once and Acme sends the invoice every cycle. Pick monthly, quarterly, or
          yearly, and pause any time from the invoice page.
        </p>
        <ul className="space-y-1.5 text-[13px] text-white/70">
          <li>– New: schedules on any invoice</li>
          <li>– New: pause and resume a schedule</li>
          <li>– Limitation: one schedule per invoice</li>
        </ul>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Tag>whatChanged.0</Tag>
          <Tag>limitations.0</Tag>
        </div>
      </div>
    </Window>
  )
}
