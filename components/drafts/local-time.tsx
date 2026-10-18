'use client'

import * as React from 'react'

function noSubscription(): () => void {
  return () => {}
}

/** False during the server render and hydration, true in the browser after. */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  )
}

/**
 * A time in the reader's own zone and locale. The server knows neither, so
 * it renders an empty element and the browser fills it in: rendering the
 * server's zone instead would mismatch on hydration and show the wrong time.
 */
export function LocalTime({
  options,
  value,
}: {
  options?: Intl.DateTimeFormatOptions
  value: Date | string
}) {
  const hydrated = useHydrated()
  const date = new Date(value)
  return (
    <time dateTime={date.toISOString()}>
      {hydrated ? date.toLocaleString(undefined, options) : null}
    </time>
  )
}
