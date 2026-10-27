'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useInView, useReducedMotion } from 'motion/react'

const noSubscription = () => () => {}

/**
 * Steps a diagram through `count` stages once it scrolls into view, one stage
 * every `intervalMs`, then holds the last stage. The server render, and any
 * visitor who prefers reduced motion, gets the final stage so the whole
 * picture shows without animation.
 */
export function useDiagramStep<T extends Element>(count: number, intervalMs = 900) {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false)
  const reduce = useReducedMotion() === true
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!inView || reduce || step >= count - 1) return
    const timer = setTimeout(() => setStep((current) => current + 1), intervalMs)
    return () => clearTimeout(timer)
  }, [count, inView, intervalMs, reduce, step])

  const animating = hydrated && !reduce
  return { ref, step: animating ? step : count - 1, animating }
}
