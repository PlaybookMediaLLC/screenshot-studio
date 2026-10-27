'use client'

import { useRef } from 'react'
import type { FocusRegion } from '@/lib/creative-sets/document'
import { Input } from '@/components/ui/input'

/** Drag on the actual evidence, with equivalent keyboard-accessible numeric controls. */
export function FocusPicker({
  src,
  value,
  onChange,
}: {
  src: string
  value: FocusRegion
  onChange: (region: FocusRegion) => void
}) {
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(0.98, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(0.98, (event.clientY - rect.top) / rect.height)),
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Drag over the detail that proves your benefit.
      </p>
      <div
        className="relative touch-none overflow-hidden rounded-lg border"
        onPointerDown={(event) => {
          anchor.current = point(event)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!anchor.current) return
          const end = point(event)
          const x = Math.min(anchor.current.x, end.x),
            y = Math.min(anchor.current.y, end.y)
          onChange({
            x,
            y,
            width: Math.min(1 - x, Math.max(0.02, Math.abs(end.x - anchor.current.x))),
            height: Math.min(1 - y, Math.max(0.02, Math.abs(end.y - anchor.current.y))),
          })
        }}
        onPointerUp={() => {
          anchor.current = null
        }}
        onPointerCancel={() => {
          anchor.current = null
        }}
      >
        <img
          src={src}
          alt="Product evidence; select the focus region below or drag on the image"
          draggable={false}
          className="block h-auto w-full select-none"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/15 shadow-[0_0_0_999px_#00000044]"
          style={{
            left: `${value.x * 100}%`,
            top: `${value.y * 100}%`,
            width: `${value.width * 100}%`,
            height: `${value.height * 100}%`,
          }}
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((field) => (
          <label key={field} className="text-xs capitalize">
            {field} %
            <Input
              aria-label={`Focus ${field} percent`}
              type="number"
              min={field === 'width' || field === 'height' ? 2 : 0}
              max={100}
              step={1}
              value={Math.round(value[field] * 100)}
              onChange={(event) => {
                const next = {
                  ...value,
                  [field]: Math.max(
                    field === 'width' || field === 'height' ? 0.02 : 0,
                    Math.min(1, Number(event.target.value) / 100)
                  ),
                }
                next.x = Math.min(next.x, 0.98)
                next.y = Math.min(next.y, 0.98)
                next.width = Math.min(next.width, 1 - next.x)
                next.height = Math.min(next.height, 1 - next.y)
                onChange(next)
              }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
