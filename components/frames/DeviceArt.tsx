'use client'

import { useId, type ReactNode } from 'react'
import { type DeviceArt, deviceArtColor, deviceArtGeometry } from '@/lib/frames/devices'
import type { DeviceOrientation } from '@/lib/frames/schema'

/**
 * Drawn devices: the body behind the screen and the details in front of it
 * (camera, notch), as SVG in the device's own millimetres. The screen itself
 * is HTML placed between the two, so it crops, drops, and exports like any
 * other screen.
 */

type Layer = 'body' | 'front'

function Phone({
  art,
  body,
  layer,
  trim,
}: {
  art: DeviceArt
  body: string
  layer: Layer
  trim: string
}) {
  const { height: H, screen, width: W } = art
  const r = art.bodyRadius
  if (layer === 'front') {
    const radius = screen.width * 0.019
    return (
      <circle
        cx={W / 2}
        cy={screen.y + screen.width * 0.05}
        fill="#050506"
        r={radius}
        stroke="#1f2023"
        strokeWidth={radius * 0.35}
      />
    )
  }
  return (
    <>
      <rect fill={trim} height={H * 0.07} rx={0.5} width={1.4} x={W - 1.4} y={H * 0.25} />
      <rect fill={trim} height={H * 0.12} rx={0.5} width={1.4} x={W - 1.4} y={H * 0.36} />
      <rect fill={body} height={H} rx={r} width={W - 1.2} x={0.6} y={0} />
      <rect fill="#0b0b0d" height={H - 1.4} rx={r - 0.7} width={W - 2.6} x={1.3} y={0.7} />
      <rect
        fill="none"
        height={H}
        rx={r}
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={0.3}
        width={W - 1.2}
        x={0.6}
        y={0}
      />
    </>
  )
}

function Tablet({ art, body, layer }: { art: DeviceArt; body: string; layer: Layer }) {
  const { height: H, screen, width: W } = art
  const r = art.bodyRadius
  if (layer === 'front') {
    // The front camera sits on the landscape edge.
    return <circle cx={(screen.x + screen.width + W) / 2} cy={H / 2} fill="#141416" r={0.95} />
  }
  return (
    <>
      <rect fill={body} height={H} rx={r} width={W} x={0} y={0} />
      <rect fill="#0b0b0d" height={H - 1.8} rx={r - 0.9} width={W - 1.8} x={0.9} y={0.9} />
      <rect
        fill="none"
        height={H}
        rx={r}
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={0.4}
        width={W}
        x={0}
        y={0}
      />
    </>
  )
}

function Laptop({
  art,
  body,
  layer,
  trim,
}: {
  art: DeviceArt
  body: string
  layer: Layer
  trim: string
}) {
  const { screen } = art
  const lid = { height: 197, width: 300, x: 20 }
  if (layer === 'front') {
    const notch = { height: 5.6, width: 28 }
    const left = screen.x + screen.width / 2 - notch.width / 2
    return (
      <>
        <path
          d={`M${left} ${screen.y} h${notch.width} v${notch.height - 2} a2 2 0 0 1 -2 2 h${-(notch.width - 4)} a2 2 0 0 1 -2 -2 z`}
          fill="#0a0a0b"
        />
        <circle
          cx={left + notch.width / 2}
          cy={screen.y + notch.height / 2}
          fill="#1d2330"
          r={0.9}
        />
      </>
    )
  }
  return (
    <>
      <path
        d={`M${lid.x} ${lid.height} V9 a9 9 0 0 1 9 -9 h${lid.width - 18} a9 9 0 0 1 9 9 V${lid.height} z`}
        fill={body}
      />
      <rect
        fill="#0a0a0b"
        height={lid.height - 2.4}
        rx={7.8}
        width={lid.width - 2.4}
        x={lid.x + 1.2}
        y={1.2}
      />
      <path
        d={`M0 ${lid.height} H340 V${lid.height + 6} a4 4 0 0 1 -4 4 H4 a4 4 0 0 1 -4 -4 z`}
        fill={trim}
      />
      <rect fill="rgba(255,255,255,0.35)" height={0.6} width={340} x={0} y={lid.height} />
      <path
        d={`M145 ${lid.height} h50 v1.6 a1.6 1.6 0 0 1 -1.6 1.6 h-46.8 a1.6 1.6 0 0 1 -1.6 -1.6 z`}
        fill="rgba(0,0,0,0.22)"
      />
    </>
  )
}

function IMac({
  art,
  body,
  layer,
  trim,
}: {
  art: DeviceArt
  body: string
  layer: Layer
  trim: string
}) {
  const { screen } = art
  const panelHeight = 380
  const bezelBottom = screen.y + screen.height + 12.5
  if (layer === 'front') return <circle cx={273.5} cy={screen.y / 2} fill="#202022" r={1.7} />
  return (
    <>
      <rect fill={trim} height={80} width={141} x={203} y={panelHeight - 10} />
      <rect fill={trim} height={15} rx={4} width={181} x={183} y={446} />
      <rect fill="rgba(0,0,0,0.12)" height={3} width={181} x={183} y={446} />
      <rect fill={body} height={panelHeight} rx={art.bodyRadius} width={547} x={0} y={0} />
      <path
        d={`M0 ${bezelBottom} V12 a12 12 0 0 1 12 -12 H535 a12 12 0 0 1 12 12 V${bezelBottom} z`}
        fill="#f4f4f2"
      />
      <rect fill="rgba(0,0,0,0.06)" height={0.8} width={547} x={0} y={bezelBottom} />
    </>
  )
}

function Display({
  art,
  body,
  layer,
  trim,
}: {
  art: DeviceArt
  body: string
  layer: Layer
  trim: string
}) {
  const { screen } = art
  const panelHeight = screen.y * 2 + screen.height
  if (layer === 'front')
    return <circle cx={art.width / 2} cy={screen.y * 0.6} fill="#1c1c1e" r={1.4} />
  return (
    <>
      <rect fill={trim} height={126} width={161} x={231} y={panelHeight - 24} />
      <rect fill="rgba(0,0,0,0.1)" height={126} width={10} x={231} y={panelHeight - 24} />
      <rect fill={trim} height={16} rx={3} width={211} x={206} y={462} />
      <rect fill={body} height={panelHeight} rx={art.bodyRadius} width={art.width} x={0} y={0} />
      <rect
        fill="#0a0a0b"
        height={panelHeight - 6}
        rx={art.bodyRadius - 2}
        width={art.width - 6}
        x={3}
        y={3}
      />
    </>
  )
}

function Vision({
  body,
  geometry,
  gradientId,
  layer,
  trim,
}: {
  body: string
  geometry: { height: number; screen: DeviceArt['screen']; width: number }
  gradientId: string
  layer: Layer
  trim: string
}) {
  const { screen, width } = geometry
  const windowHeight = screen.y * 2 + screen.height
  if (layer === 'front') return null
  const bar = { height: 14, width: 160 }
  const barY = windowHeight + 30
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0.4" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.32)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <rect fill={body} height={windowHeight} rx={46} width={width} x={0} y={0} />
      <rect fill={`url(#${gradientId})`} height={windowHeight} rx={46} width={width} x={0} y={0} />
      <rect
        fill="none"
        height={windowHeight - 1.5}
        rx={45}
        stroke={trim}
        strokeOpacity={0.6}
        strokeWidth={1.5}
        width={width - 1.5}
        x={0.75}
        y={0.75}
      />
      <rect
        fill={trim}
        height={bar.height}
        rx={bar.height / 2}
        width={bar.width}
        x={width / 2 - bar.width / 2}
        y={barY}
      />
      <circle
        cx={width / 2 - bar.width / 2 - 26}
        cy={barY + bar.height / 2}
        fill={trim}
        r={bar.height / 2}
      />
    </>
  )
}

function ArtLayer({
  art,
  colorId,
  layer,
  orientation,
}: {
  art: DeviceArt
  colorId?: string
  layer: Layer
  orientation?: DeviceOrientation
}) {
  const gradientId = useId()
  const geometry = deviceArtGeometry(art, orientation)
  const { body, trim } = deviceArtColor(art, colorId)
  const native = (() => {
    switch (art.kind) {
      case 'phone':
        return <Phone art={art} body={body} layer={layer} trim={trim} />
      case 'tablet':
        return <Tablet art={art} body={body} layer={layer} />
      case 'laptop':
        return <Laptop art={art} body={body} layer={layer} trim={trim} />
      case 'imac':
        return <IMac art={art} body={body} layer={layer} trim={trim} />
      case 'display':
        return <Display art={art} body={body} layer={layer} trim={trim} />
      case 'vision':
        return (
          <Vision
            body={body}
            geometry={geometry}
            gradientId={gradientId}
            layer={layer}
            trim={trim}
          />
        )
    }
  })()
  if (!native) return null
  return (
    <svg
      aria-hidden="true"
      preserveAspectRatio="none"
      style={{ inset: 0, overflow: 'visible', pointerEvents: 'none', position: 'absolute' }}
      height="100%"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      width="100%"
    >
      {/* A quarter turn counter-clockwise keeps the screenshot upright in landscape. */}
      {geometry.rotated ? (
        <g transform={`translate(0 ${art.width}) rotate(-90)`}>{native}</g>
      ) : (
        native
      )}
    </svg>
  )
}

/** A drawn device around its screen: `screen` is placed at the device's screen rectangle. */
export function DrawnDevice({
  art,
  colorId,
  orientation,
  screen,
}: {
  art: DeviceArt
  colorId?: string
  orientation?: DeviceOrientation
  screen: (placement: {
    borderRadius: string
    height: string
    left: string
    top: string
    width: string
  }) => ReactNode
}) {
  const geometry = deviceArtGeometry(art, orientation)
  const rect = geometry.screen
  const percent = (value: number, of: number) => `${(value / of) * 100}%`
  return (
    <div
      data-drawn-device={art.kind}
      style={{
        filter: art.kind === 'vision' ? undefined : 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))',
        height: '100%',
        position: 'relative',
        width: '100%',
      }}
    >
      <ArtLayer art={art} colorId={colorId} layer="body" orientation={orientation} />
      {screen({
        borderRadius: `${percent(rect.radius, rect.width)} / ${percent(rect.radius, rect.height)}`,
        height: percent(rect.height, geometry.height),
        left: percent(rect.x, geometry.width),
        top: percent(rect.y, geometry.height),
        width: percent(rect.width, geometry.width),
      })}
      <ArtLayer art={art} colorId={colorId} layer="front" orientation={orientation} />
    </div>
  )
}
