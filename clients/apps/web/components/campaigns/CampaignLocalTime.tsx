'use client'

import { useSyncExternalStore } from 'react'

const subscribeToNothing = () => () => {}

export function CampaignLocalTime({ value }: { value: string }) {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )
  return (
    <time dateTime={value}>
      {hydrated
        ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : '…'}
    </time>
  )
}
