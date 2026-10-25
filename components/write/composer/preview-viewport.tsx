'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Fit a phone's real CSS viewport into the available sidebar without changing its wrapping. */
export function PreviewViewport({
  children,
  size,
  testId,
}: {
  children: ReactNode
  size?: { width: number; height: number }
  testId: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const scale = size ? Math.min(1, (width || 280) / size.width) : 1
  return (
    <div
      ref={container}
      className="relative w-full min-w-0"
      data-testid="preview-viewport"
      style={size ? { height: size.height * scale } : undefined}
    >
      <div
        className="mx-auto w-full overflow-x-hidden overflow-y-auto rounded-2xl border border-white/10 bg-black"
        data-testid={testId}
        data-device-width={size?.width}
        data-scale={scale}
        style={
          size
            ? {
                position: 'absolute',
                left: '50%',
                marginLeft: -size.width / 2,
                width: size.width,
                height: size.height,
                transform: `scale(${scale})`,
                transformOrigin: 'top center',
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}
