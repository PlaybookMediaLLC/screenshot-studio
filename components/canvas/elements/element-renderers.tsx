'use client'

import type { CSSProperties, ReactNode } from 'react'
import { withAlpha } from '@/lib/editor/elements/color'
import {
  type CanvasElement,
  type ElementOf,
  type ElementType,
  formatBadgeNumber,
} from '@/lib/editor/elements/schema'
import { type CanvasGeometry, fallbackImageRect } from './canvas-geometry'

/** A rendered element's box in stage px. */
export type ElementBox = { height: number; width: number; x: number; y: number }

type RendererProps<Type extends ElementType> = {
  box: ElementBox
  element: ElementOf<Type>
  geometry: CanvasGeometry
}

function dropShadow(shadow: { blur: number; color: string; enabled: boolean; offsetX: number; offsetY: number }) {
  return shadow.enabled
    ? `drop-shadow(${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color})`
    : undefined
}

function Badge({ box, element }: RendererProps<'badge'>) {
  const { props } = element
  const size = Math.min(box.width, box.height)
  return (
    <div
      style={{
        alignItems: 'center',
        background: props.background,
        border: `${props.borderWidth}px solid ${props.borderColor}`,
        borderRadius: props.shape === 'square' ? size * 0.22 : 9999,
        boxSizing: 'border-box',
        color: props.color,
        display: 'flex',
        filter: dropShadow(props.shadow),
        fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
        fontSize: box.height * props.fontScale,
        fontWeight: 700,
        height: '100%',
        justifyContent: 'center',
        lineHeight: 1,
        width: '100%',
      }}
    >
      {formatBadgeNumber(props.number, props.numbering)}
    </div>
  )
}

/** Cursor shapes on a 24×24 grid, with the point a click lands on. */
const CURSORS: Record<ElementOf<'cursor'>['props']['kind'], { hotspot: [number, number]; path: string }> = {
  arrow: { hotspot: [3, 2], path: 'M3 2v17.5l4.6-4.4 3 6.6 3.2-1.4-3-6.5h6.4z' },
  crosshair: {
    hotspot: [12, 12],
    path: 'M11 2h2v7h-2zm0 13h2v7h-2zM2 11h7v2H2zm13 0h7v2h-7zm-3-2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  },
  grab: {
    hotspot: [12, 10],
    path: 'M7.5 9V5.6a1.5 1.5 0 0 1 3 0V9h.5V4.2a1.5 1.5 0 0 1 3 0V9h.5V5.4a1.5 1.5 0 0 1 3 0V10h.4V8.2a1.5 1.5 0 0 1 3 0v6.1c0 4.1-2.8 7.2-6.7 7.2h-1.6c-2.4 0-3.9-1-5.3-2.9L4.2 15a1.6 1.6 0 0 1 2.6-1.9l.7.9z',
  },
  pointer: {
    hotspot: [10.5, 2.5],
    path: 'M9 3.2a1.5 1.5 0 0 1 3 0V10h.6V7.1a1.5 1.5 0 0 1 3 0V10h.5V8.4a1.5 1.5 0 0 1 3 0v5.9c0 4.1-2.6 7.2-6.5 7.2h-1.4c-2.5 0-3.8-1.1-5.2-2.9l-2.7-3.6a1.6 1.6 0 0 1 2.4-2.1L9 15.1z',
  },
  text: {
    hotspot: [12, 12],
    path: 'M8 3h3c.5 0 .9.2 1 .6.1-.4.5-.6 1-.6h3v2h-2.8v14H16v2h-3c-.5 0-.9-.2-1-.6-.1.4-.5.6-1 .6H8v-2h2.8V5H8z',
  },
}

function Cursor({ element }: RendererProps<'cursor'>) {
  const { props } = element
  const shape = CURSORS[props.kind]
  const [hx, hy] = shape.hotspot
  return (
    <svg
      height="100%"
      style={{ filter: dropShadow(props.shadow), overflow: 'visible' }}
      viewBox="0 0 24 24"
      width="100%"
    >
      {props.click.enabled ? (
        <>
          <circle cx={hx} cy={hy} fill={withAlpha(props.click.color, 0.35)} r={4 * props.click.size} />
          <circle cx={hx} cy={hy} fill="none" r={6 * props.click.size} stroke={props.click.color} strokeWidth={1} />
        </>
      ) : null}
      <path d={shape.path} fill={props.fill} stroke={props.stroke} strokeLinejoin="round" strokeWidth={1.4} />
    </svg>
  )
}

function Spotlight({ box, element }: RendererProps<'spotlight'>) {
  const { props } = element
  const shorter = Math.min(box.width, box.height)
  const radius = props.shape === 'ellipse' ? '50%' : `${props.radius * shorter}px`
  // The bright region is the box; everything outside it is dimmed by its
  // shadow, which the canvas clips at its edge. Blur feathers the inner edge.
  return (
    <div
      style={{
        borderRadius: radius,
        boxShadow: `0 0 ${props.feather * shorter}px 400vmax ${withAlpha(props.color, props.dim)}`,
        height: '100%',
        pointerEvents: 'none',
        width: '100%',
      }}
    />
  )
}

/** The callout's screenshot region in stage px, from its source point and zoom. */
export function calloutSourceRect(element: ElementOf<'callout'>, box: ElementBox, geometry: CanvasGeometry) {
  const image = fallbackImageRect(geometry)
  if (!image) return null
  const width = box.width / element.props.zoom
  const height = box.height / element.props.zoom
  return {
    height,
    width,
    x: image.x + element.props.source.x * image.width - width / 2,
    y: image.y + element.props.source.y * image.height - height / 2,
  }
}

function Callout({ box, element, geometry }: RendererProps<'callout'>) {
  const { props } = element
  const image = fallbackImageRect(geometry)
  const radius =
    props.shape === 'circle' ? '50%' : props.shape === 'rounded' ? `${Math.min(box.width, box.height) * 0.12}px` : 0
  const frame: CSSProperties = {
    border: `${props.borderWidth}px solid ${props.borderColor}`,
    borderRadius: radius,
    boxSizing: 'border-box',
    filter: dropShadow(props.shadow),
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  }
  if (!geometry.imageSrc || !image) return <div style={{ ...frame, background: 'rgba(127,127,127,0.25)' }} />
  const width = image.width * props.zoom
  const height = image.height * props.zoom
  return (
    <div style={frame}>
      <img
        alt=""
        draggable={false}
        src={geometry.imageSrc}
        style={{
          filter: geometry.imageFilter,
          height,
          left: box.width / 2 - props.borderWidth - props.source.x * width,
          maxWidth: 'none',
          objectFit: 'cover',
          position: 'absolute',
          top: box.height / 2 - props.borderWidth - props.source.y * height,
          width,
        }}
      />
    </div>
  )
}

/** Draws one element inside its box. */
export function ElementContent({
  box,
  element,
  geometry,
}: {
  box: ElementBox
  element: CanvasElement
  geometry: CanvasGeometry
}): ReactNode {
  switch (element.type) {
    case 'badge':
      return <Badge box={box} element={element} geometry={geometry} />
    case 'cursor':
      return <Cursor box={box} element={element} geometry={geometry} />
    case 'spotlight':
      return <Spotlight box={box} element={element} geometry={geometry} />
    case 'callout':
      return <Callout box={box} element={element} geometry={geometry} />
  }
}
