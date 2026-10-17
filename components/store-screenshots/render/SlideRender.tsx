'use client'

import * as React from 'react'
import type { Background } from '@/lib/store-screenshots/document/schema'
import { boxTransformCss } from '@/lib/store-screenshots/engine/geometry'
import type {
  Scene,
  SceneBackground,
  SceneCallout,
  SceneImage,
  SceneText,
} from '@/lib/store-screenshots/engine/scene'
import type { AnimationLayer } from '@/lib/store-screenshots/animation/timeline'
import { AnnotationView } from './AnnotationView'
import { DeviceView } from './DeviceView'
import { spanStyle, textBlockStyle } from './text-style'

/**
 * Paints a `Scene` at its native pixel size. It has no event handlers and no
 * editor chrome: the canvas, thumbnails, store previews, image export, and
 * animation frames all render this component, so they cannot disagree.
 */

/** Resolves an asset id to a URL the browser can load, or null while loading. */
export type AssetResolver = (assetId: string) => string | null

function backgroundCss(fill: Background): React.CSSProperties {
  if (fill.kind === 'solid') return { background: fill.color }
  if (fill.kind === 'linear') return { background: `linear-gradient(${fill.angle}deg, ${fill.from} 0%, ${fill.to} 100%)` }
  return { background: fill.color }
}

function BackgroundView({
  background,
  height,
  resolveAsset,
}: {
  background: SceneBackground
  height: number
  resolveAsset: AssetResolver
}): React.JSX.Element {
  const { fill } = background
  const src = fill.kind === 'image' ? resolveAsset(fill.assetId) : null
  return (
    <div
      aria-hidden="true"
      data-store-background=""
      style={{
        position: 'absolute',
        left: -background.offsetX,
        top: 0,
        width: background.spanWidth,
        height,
        ...backgroundCss(fill),
      }}
    >
      {fill.kind === 'image' && src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="sync"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            objectFit: fill.fit,
            objectPosition: `${fill.focusX}% ${fill.focusY}%`,
          }}
        />
      ) : null}
    </div>
  )
}

/** Rich text content of a text node, shared with the inline editor's read-only state. */
export function RichTextContent({ node }: { node: SceneText }): React.JSX.Element {
  return (
    <>
      {node.content.map((span, index) => (
        <span key={index} style={spanStyle(span, node.style)}>
          {span.text}
        </span>
      ))}
    </>
  )
}

/** CSS that positions and styles a text node; the inline editor reuses it. */
export function textNodeStyle(node: SceneText): React.CSSProperties {
  return {
    position: 'absolute',
    left: node.box.x,
    top: node.box.y,
    width: node.box.width,
    minHeight: node.box.height,
    transform: boxTransformCss(node.box.height, node.rotation, node.tiltX, node.tiltY),
    transformOrigin: 'center',
    opacity: node.opacity,
    ...textBlockStyle(node.style, node.fontSizePx, node.color, node.direction),
  }
}

const TextView = React.memo(function TextView({ node, hidden }: { node: SceneText; hidden: boolean }): React.JSX.Element {
  return (
    <div
      data-store-layer={node.layerId}
      data-store-layer-type="text"
      data-store-text-role={node.role}
      style={{ ...textNodeStyle(node), visibility: hidden ? 'hidden' : undefined }}
    >
      <RichTextContent node={node} />
    </div>
  )
})

const ImageView = React.memo(function ImageView({
  node,
  resolveAsset,
}: {
  node: SceneImage
  resolveAsset: AssetResolver
}): React.JSX.Element | null {
  const src = resolveAsset(node.assetId)
  if (!src) return null
  return (
    <img
      data-store-layer={node.layerId}
      data-store-layer-type="image"
      src={src}
      alt=""
      draggable={false}
      decoding="sync"
      style={{
        position: 'absolute',
        left: node.box.x,
        top: node.box.y,
        width: node.box.width,
        height: node.box.height,
        maxWidth: 'none',
        objectFit: 'contain',
        transform: boxTransformCss(node.box.height, node.rotation, node.tiltX, node.tiltY),
        opacity: node.opacity,
      }}
    />
  )
})

function CalloutConnector({ node, width, height }: { node: SceneCallout; width: number; height: number }): React.JSX.Element | null {
  if (!node.callout.connector || !node.anchor || node.regionHidden) return null
  const center = { x: node.box.x + node.box.width / 2, y: node.box.y + node.box.height / 2 }
  const stroke = Math.max(1.5, node.callout.borderWidth * node.unit * 0.6)
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: node.opacity }}
    >
      <line x1={node.anchor.x} y1={node.anchor.y} x2={center.x} y2={center.y} stroke={node.callout.borderColor} strokeWidth={stroke} strokeLinecap="round" />
      <circle cx={node.anchor.x} cy={node.anchor.y} r={stroke * 2.2} fill={node.callout.borderColor} />
    </svg>
  )
}

const CalloutView = React.memo(function CalloutView({
  node,
  resolveAsset,
}: {
  node: SceneCallout
  resolveAsset: AssetResolver
}): React.JSX.Element {
  const src = node.sourceAssetId ? resolveAsset(node.sourceAssetId) : null
  const { box, callout } = node
  const filters = node.filters
  const radius = callout.shape === 'circle' ? '50%' : callout.shape === 'rounded' ? Math.min(box.width, box.height) * 0.12 : 0
  return (
    <div
      data-store-layer={node.layerId}
      data-store-layer-type="callout"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        transform: boxTransformCss(box.height, node.rotation, node.tiltX, node.tiltY),
        borderRadius: radius,
        overflow: 'hidden',
        opacity: node.opacity,
        background: '#FFFFFF',
        boxShadow: [
          `0 0 0 ${callout.borderWidth * node.unit}px ${callout.borderColor}`,
          callout.shadow > 0
            ? `0 ${callout.shadow * 0.2 * node.unit}px ${callout.shadow * 0.6 * node.unit}px rgba(0,0,0,${0.1 + callout.shadow / 400})`
            : '',
        ]
          .filter(Boolean)
          .join(', '),
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="sync"
          style={{
            position: 'absolute',
            left: node.image.x,
            top: node.image.y,
            width: node.image.width,
            height: node.image.height,
            maxWidth: 'none',
            filter: `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%)`,
          }}
        />
      ) : null}
    </div>
  )
})

/**
 * A slide at native size. `hiddenLayerIds` hides layers the editor is
 * drawing itself (inline text editing); `only` draws one animation layer
 * (background, content, or text) on a transparent slide.
 */
export const SlideRender = React.memo(function SlideRender({
  scene,
  resolveAsset,
  hiddenLayerIds,
  className,
  only,
}: {
  scene: Scene
  resolveAsset: AssetResolver
  hiddenLayerIds?: ReadonlySet<string>
  className?: string
  only?: AnimationLayer
}): React.JSX.Element {
  const showBackground = !only || only === 'background'
  const nodes = !only ? scene.nodes : only === 'background' ? [] : scene.nodes.filter((node) => (only === 'text') === (node.type === 'text'))
  return (
    <div
      data-store-slide-render={scene.slideId}
      className={className}
      style={{
        position: 'relative',
        width: scene.width,
        height: scene.height,
        overflow: 'hidden',
        isolation: 'isolate',
        background: showBackground ? '#FFFFFF' : 'transparent',
      }}
    >
      {showBackground ? <BackgroundView background={scene.background} height={scene.height} resolveAsset={resolveAsset} /> : null}
      {nodes.map((node) => {
        switch (node.type) {
          case 'text':
            return <TextView key={node.layerId} node={node} hidden={hiddenLayerIds?.has(node.layerId) ?? false} />
          case 'device':
            return <DeviceView key={node.layerId} node={node} resolveAsset={resolveAsset} slideWidth={scene.width} />
          case 'image':
            return <ImageView key={node.layerId} node={node} resolveAsset={resolveAsset} />
          case 'annotation':
            return <AnnotationView key={node.layerId} node={node} />
          case 'callout':
            return (
              <React.Fragment key={node.layerId}>
                <CalloutConnector node={node} width={scene.width} height={scene.height} />
                <CalloutView node={node} resolveAsset={resolveAsset} />
              </React.Fragment>
            )
        }
      })}
    </div>
  )
})
