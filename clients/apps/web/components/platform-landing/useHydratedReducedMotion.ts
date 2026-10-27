'use client'

import { useSyncExternalStore } from 'react'
import { useReducedMotion } from 'motion/react'

const noSubscription = () => () => {}

/**
 * The user's reduced-motion preference, reported as false until hydration
 * finishes so the first client render matches the server HTML.
 */
export function useHydratedReducedMotion(): boolean {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  )
  const reduce = useReducedMotion()
  return hydrated && reduce === true
}
