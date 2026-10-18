import {
  BlueskyIcon,
  InstagramIcon,
  Linkedin01Icon,
  MastodonIcon,
  NewTwitterIcon,
  ThreadsIcon,
} from 'hugeicons-react'
import type { DraftChannel } from '@/lib/content-drafts/serialize'

/** How each channel is named and drawn in the composer. */
export const CHANNEL_META: Record<DraftChannel, { icon: typeof NewTwitterIcon; label: string }> = {
  bluesky: { icon: BlueskyIcon, label: 'Bluesky' },
  instagram: { icon: InstagramIcon, label: 'Instagram' },
  linkedin: { icon: Linkedin01Icon, label: 'LinkedIn' },
  mastodon: { icon: MastodonIcon, label: 'Mastodon' },
  threads: { icon: ThreadsIcon, label: 'Threads' },
  x: { icon: NewTwitterIcon, label: 'X' },
}

/** A channel's icon at the composer's small size. */
export function ChannelIcon({ channel, className }: { channel: DraftChannel; className?: string }) {
  const Icon = CHANNEL_META[channel].icon
  return <Icon aria-hidden className={className ?? 'size-3.5'} />
}
