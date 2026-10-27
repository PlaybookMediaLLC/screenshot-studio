'use client'

import * as React from 'react'
import { boxTransformCss } from '@/lib/store-screenshots/engine/geometry'
import type { SceneAnnotation } from '@/lib/store-screenshots/engine/scene'

/**
 * Annotation drawing. All marks are original vector shapes sized from the
 * node box, so they scale cleanly to every export size. Text such as a
 * rating or award name comes from the user; nothing is filled in by default.
 */

const FONT = 'var(--font-inter), system-ui, sans-serif'

function Star({ fill, x, size, color }: { fill: number; x: number; size: number; color: string }): React.JSX.Element {
  const id = React.useId()
  const path = 'M12 2.2l2.95 6.3 6.85.75-5.1 4.65 1.45 6.75L12 17.2l-6.15 3.45 1.45-6.75-5.1-4.65 6.85-.75z'
  return (
    <svg x={x} y={0} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id}>
          <stop offset={fill} stopColor={color} />
          <stop offset={fill} stopColor={color} stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <path d={path} fill={`url(#${id})`} />
    </svg>
  )
}

function Laurel({ mirrored, color }: { mirrored: boolean; color: string }): React.JSX.Element {
  const leaves = Array.from({ length: 6 }, (_, index) => {
    const angle = -70 + index * 26
    const y = 88 - index * 14
    const x = 26 + Math.sin(((index * 20) * Math.PI) / 180) * 8
    return <ellipse key={index} cx={x} cy={y} rx="5" ry="11" transform={`rotate(${angle} ${x} ${y})`} fill={color} />
  })
  return (
    <svg viewBox="0 0 48 100" style={{ height: '100%', transform: mirrored ? 'scaleX(-1)' : undefined }} aria-hidden="true">
      <path d="M38 96C18 82 12 52 24 8" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
      {leaves}
    </svg>
  )
}

function Body({ node }: { node: SceneAnnotation }): React.JSX.Element {
  const { annotation: a, box, unit } = node
  const fill = a.fill ?? a.color
  const font = Math.min(box.height * 0.42, box.width * 0.2)
  const text = (size: number, color: string, weight = 700): React.CSSProperties => ({
    fontFamily: FONT,
    fontSize: size,
    fontWeight: weight,
    color,
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  })
  switch (a.kind) {
    case 'step':
      return (
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: fill, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 ${4 * unit}px ${14 * unit}px rgba(0,0,0,0.18)` }}>
          <span style={text(Math.min(box.width, box.height) * 0.5, a.textColor)}>{a.text || Math.max(1, Math.round(a.value))}</span>
        </div>
      )
    case 'label':
    case 'badge':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: a.kind === 'label' ? box.height : box.height * 0.24,
            background: fill,
            border: a.strokeWidth > 0 ? `${a.strokeWidth * unit}px solid ${a.color}` : undefined,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            padding: `0 ${box.height * 0.3}px`,
            boxShadow: `0 ${4 * unit}px ${16 * unit}px rgba(0,0,0,0.14)`,
          }}
        >
          <span style={text(a.caption ? font * 0.82 : font, a.textColor)}>{a.text}</span>
          {a.caption ? <span style={text(font * 0.5, a.textColor, 500)}>{a.caption}</span> : null}
        </div>
      )
    case 'arrow': {
      const stroke = Math.max(1, a.strokeWidth * unit)
      const head = stroke * 3.2
      const midY = box.height / 2
      const control = { x: box.width / 2, y: midY - a.curve * box.height }
      const end = { x: box.width - head * 0.6, y: midY }
      const angle = Math.atan2(end.y - control.y, end.x - control.x)
      const tip = { x: box.width, y: midY + Math.sin(angle) * head * 0.6 }
      const left = { x: tip.x - head * Math.cos(angle - 0.45), y: tip.y - head * Math.sin(angle - 0.45) }
      const right = { x: tip.x - head * Math.cos(angle + 0.45), y: tip.y - head * Math.sin(angle + 0.45) }
      return (
        <svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`} style={{ overflow: 'visible' }} aria-hidden="true">
          <path d={`M ${stroke} ${midY} Q ${control.x} ${control.y} ${end.x} ${end.y}`} stroke={a.color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
          <path d={`M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`} fill={a.color} stroke={a.color} strokeWidth={stroke * 0.4} strokeLinejoin="round" />
        </svg>
      )
    }
    case 'highlight':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            border: `${Math.max(1, a.strokeWidth * unit)}px solid ${a.color}`,
            borderRadius: a.shape === 'ellipse' ? '50%' : Math.min(box.width, box.height) * 0.12,
            background: a.fill ? `${a.fill}40` : undefined,
          }}
        />
      )
    case 'rating': {
      const size = Math.min(box.height * (a.text || a.caption ? 0.48 : 0.9), box.width / 5.6)
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: size * 0.12 }}>
          <svg width={size * 5.4} height={size} viewBox={`0 0 ${size * 5.4} ${size}`} aria-label={`${a.value} out of 5 stars`}>
            {[0, 1, 2, 3, 4].map((index) => (
              <Star key={index} x={index * size * 1.1} size={size} color={a.color} fill={Math.max(0, Math.min(1, a.value - index))} />
            ))}
          </svg>
          {a.text ? <span style={text(size * 0.62, a.textColor)}>{a.text}</span> : null}
          {a.caption ? <span style={text(size * 0.42, a.textColor, 500)}>{a.caption}</span> : null}
        </div>
      )
    }
    case 'laurel':
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: box.height * 0.06 }}>
          <Laurel mirrored={false} color={a.color} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
            <span style={text(box.height * 0.24, a.textColor, 800)}>{a.text}</span>
            {a.caption ? <span style={text(box.height * 0.14, a.textColor, 500)}>{a.caption}</span> : null}
          </div>
          <Laurel mirrored color={a.color} />
        </div>
      )
  }
}

/** One annotation node. */
export const AnnotationView = React.memo(function AnnotationView({ node }: { node: SceneAnnotation }): React.JSX.Element {
  const { box } = node
  return (
    <div
      data-store-layer={node.layerId}
      data-store-layer-type="annotation"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        transform: boxTransformCss(box.height, node.rotation, node.tiltX, node.tiltY),
        transformOrigin: 'center',
        opacity: node.opacity,
      }}
    >
      <Body node={node} />
    </div>
  )
})
