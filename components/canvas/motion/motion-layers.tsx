'use client'

import type { ReactNode } from 'react'
import type { LayerMotion } from '@/lib/animation/motion-evaluate'
import type { RevealMode } from '@/lib/animation/motion-schema'
import { useActiveCaptions } from '@/lib/animation/use-motion'
import { getFontCSS } from '@/lib/constants/fonts'
import { useImageStore } from '@/lib/store'

/**
 * Stage pieces for motion. They draw values evaluated at the playhead and
 * are ordinary DOM layers, so every export captures them as shown.
 */

/**
 * Moves, turns, scales, and fades a layer by its keyframed motion around
 * `origin` (a CSS transform origin). It fills the canvas, so offsets in
 * canvas fractions are percentages of its own box. The layer keeps its own
 * position, so dragging it still edits the design rather than the
 * animation. Layers without motion render bare, and animated ones keep the
 * wrapper at every time so the layer is never remounted mid-playback.
 */
export function MotionWrap({
  children,
  motion,
  origin,
}: {
  children: ReactNode
  motion: LayerMotion | undefined
  origin: string
}) {
  if (!motion) return <>{children}</>
  return (
    <div
      data-motion-layer="true"
      style={{
        inset: 0,
        opacity: motion.opacity,
        pointerEvents: 'none',
        position: 'absolute',
        transform: `translate(${motion.x * 100}%, ${motion.y * 100}%) rotate(${motion.rotation}deg) scale(${motion.scale})`,
        transformOrigin: origin,
      }}
    >
      {children}
    </div>
  )
}

/**
 * A text part way through its reveal. Hidden characters keep their space, so
 * the text never reflows while it types; words fade in over their slot.
 */
export function RevealedText({
  mode,
  revealed,
  units,
}: {
  mode: RevealMode
  revealed: number
  units: string[]
}) {
  if (mode === 'typewriter') {
    const shown = Math.floor(revealed + 1e-6)
    return (
      <>
        {units.slice(0, shown).join('')}
        <span style={{ visibility: 'hidden' }}>{units.slice(shown).join('')}</span>
      </>
    )
  }
  return (
    <>
      {units.map((unit, index) => {
        const amount = Math.max(0, Math.min(1, revealed - index))
        return (
          <span
            key={index}
            style={
              amount === 0 ? { visibility: 'hidden' } : amount < 1 ? { opacity: amount } : undefined
            }
          >
            {unit}
          </span>
        )
      })}
    </>
  )
}

/** Captions burned into the stage at the playhead, styled by the caption track. */
export function CaptionLayer({ canvasH, canvasW }: { canvasH: number; canvasW: number }) {
  const captions = useActiveCaptions()
  const style = useImageStore((state) => state.motion.captions.style)
  if (captions.length === 0) return null
  const fontSize = style.fontSize * canvasW
  return (
    <div
      aria-live="polite"
      data-caption-layer="true"
      style={{
        height: canvasH,
        inset: 0,
        pointerEvents: 'none',
        position: 'absolute',
        width: canvasW,
        zIndex: 210,
      }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: fontSize * 0.3,
          left: '50%',
          maxWidth: canvasW * 0.86,
          position: 'absolute',
          top: `${style.y}%`,
          transform: 'translate(-50%, -50%)',
          width: 'max-content',
        }}
      >
        {captions.map((caption) => (
          <span
            data-caption-id={caption.id}
            key={caption.id}
            style={{
              background: style.background,
              borderRadius: fontSize * 0.3,
              color: style.color,
              fontFamily: getFontCSS(style.fontFamily),
              fontSize,
              fontWeight: style.fontWeight,
              lineHeight: 1.3,
              maxWidth: canvasW * 0.86,
              padding: `${fontSize * 0.25}px ${fontSize * 0.55}px`,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
            }}
          >
            {caption.text}
          </span>
        ))}
      </div>
    </div>
  )
}
