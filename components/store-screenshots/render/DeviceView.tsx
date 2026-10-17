'use client'

import * as React from 'react'
import { photoFrameFor, type FramePart } from '@/lib/store-screenshots/devices'
import { mixRgb, parseHex, toHex } from '@/lib/store-screenshots/engine/color'
import { boxTransformCss, type Rect } from '@/lib/store-screenshots/engine/geometry'
import type { SceneDevice } from '@/lib/store-screenshots/engine/scene'

/**
 * Draws one device: a photographed frame where the catalog has one for the
 * chosen finish, otherwise a procedural frame from the catalog geometry.
 * Everything is sized in output pixels from the scene node, so the editor,
 * thumbnails, and exports draw the same frame.
 */

type AssetResolver = (assetId: string) => string | null

function partStyle(part: FramePart, box: Rect): React.CSSProperties {
  return {
    position: 'absolute',
    left: part.x * box.width,
    top: part.y * box.height,
    width: part.width * box.width,
    height: part.height * box.height,
  }
}

function shade(hex: string, amount: number): string {
  return toHex(mixRgb(parseHex(hex), amount > 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }, Math.abs(amount)))
}

function SignalIcon({ level, color, size }: { level: number; color: string; size: number }): React.JSX.Element {
  return (
    <svg width={size * 1.1} height={size * 0.72} viewBox="0 0 18 12" aria-hidden="true">
      {[0, 1, 2, 3].map((bar) => (
        <rect key={bar} x={bar * 4.6} y={9 - bar * 3} width="3.2" height={3 + bar * 3} rx="0.9" fill={color} opacity={bar < level ? 1 : 0.3} />
      ))}
    </svg>
  )
}

function WifiIcon({ level, color, size }: { level: number; color: string; size: number }): React.JSX.Element {
  const arcs = ['M2 4.5a10 10 0 0 1 14 0', 'M4.6 7.2a6.3 6.3 0 0 1 8.8 0', 'M7.2 9.9a2.6 2.6 0 0 1 3.6 0']
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 18 12" aria-hidden="true">
      {arcs.map((path, index) => (
        <path key={path} d={path} stroke={color} strokeWidth="2.2" strokeLinecap="round" fill="none" opacity={3 - index <= level ? 1 : 0.3} />
      ))}
    </svg>
  )
}

function BatteryIcon({ level, color, size }: { level: number; color: string; size: number }): React.JSX.Element {
  const width = Math.max(0.6, (level / 100) * 18.4)
  return (
    <svg width={size * 1.55} height={size * 0.72} viewBox="0 0 26 12" aria-hidden="true">
      <rect x="0.6" y="0.6" width="22" height="10.8" rx="3" stroke={color} strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
      <rect x="2.4" y="2.4" width={width} height="7.2" rx="1.6" fill={color} />
      <path d="M24 4.2v3.6a1.9 1.9 0 0 0 0-3.6Z" fill={color} opacity="0.5" />
    </svg>
  )
}

function StatusBarView({ node, screen }: { node: SceneDevice; screen: Rect }): React.JSX.Element | null {
  const bar = node.statusBar
  if (!bar.visible) return null
  const ios = node.model.platform === 'ios'
  const reference = Math.min(screen.width, screen.height)
  const height = reference * (ios ? 0.125 : 0.075)
  const font = reference * (ios ? 0.042 : 0.034)
  const color = bar.textColor
  return (
    <div
      data-store-status-bar=""
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${reference * (ios ? 0.09 : 0.05)}px`,
        boxSizing: 'border-box',
        color,
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        fontWeight: 600,
        fontSize: font,
        letterSpacing: '-0.01em',
        zIndex: 2,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: font * 0.4 }}>
        <span>{bar.time}</span>
        {!ios && bar.carrier ? <span style={{ fontWeight: 500 }}>{bar.carrier}</span> : null}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: font * 0.35 }}>
        {ios && bar.carrier ? <span style={{ fontWeight: 500 }}>{bar.carrier}</span> : null}
        <SignalIcon level={bar.signal} color={color} size={font} />
        {bar.wifi > 0 ? <WifiIcon level={bar.wifi} color={color} size={font} /> : null}
        <BatteryIcon level={bar.battery} color={color} size={font} />
      </span>
    </div>
  )
}

function ScreenContent({
  node,
  screen,
  resolveAsset,
}: {
  node: SceneDevice
  screen: Rect
  resolveAsset: AssetResolver
}): React.JSX.Element {
  const src = node.assetId ? resolveAsset(node.assetId) : null
  const filters = node.filters
  const reference = Math.min(screen.width, screen.height)
  return (
    <>
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
            filter:
              filters.brightness === 100 && filters.contrast === 100 && filters.saturation === 100
                ? undefined
                : `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%)`,
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: '#E4E4E7' }} />
      )}
      {node.statusBar.visible && node.statusBar.cover ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: reference * (node.model.platform === 'ios' ? 0.125 : 0.075),
            background: node.statusBar.coverColor,
            zIndex: 1,
          }}
        />
      ) : null}
      <StatusBarView node={node} screen={screen} />
    </>
  )
}

function Cutout({ node, screen }: { node: SceneDevice; screen: Rect }): React.JSX.Element | null {
  const cutout = node.model.cutout
  if (cutout === 'none' || node.frame.style === 'frameless') return null
  const portraitWidth = node.geometry.landscape ? screen.height : screen.width
  let shape: React.CSSProperties
  if (cutout === 'dynamic-island') {
    const width = portraitWidth * 0.31
    const height = portraitWidth * 0.092
    const inset = portraitWidth * 0.028
    shape = node.geometry.landscape
      ? { left: inset, top: (screen.height - width) / 2, width: height, height: width, borderRadius: height }
      : { left: (screen.width - width) / 2, top: inset, width, height, borderRadius: height }
  } else if (cutout === 'punch-hole') {
    const size = portraitWidth * 0.032
    const inset = portraitWidth * 0.025
    shape = node.geometry.landscape
      ? { left: inset, top: (screen.height - size) / 2, width: size, height: size, borderRadius: size }
      : { left: (screen.width - size) / 2, top: inset, width: size, height: size, borderRadius: size }
  } else {
    const width = screen.width * 0.11
    const height = screen.width * 0.022
    shape = { left: (screen.width - width) / 2, top: 0, width, height, borderRadius: `0 0 ${height * 0.5}px ${height * 0.5}px` }
  }
  return <div aria-hidden="true" style={{ position: 'absolute', background: '#050505', zIndex: 3, ...shape }} />
}

function PhotoFrame({
  node,
  resolveAsset,
}: {
  node: SceneDevice
  resolveAsset: AssetResolver
}): React.JSX.Element | null {
  const photo = photoFrameFor(node.frame)
  if (!photo?.asset) return null
  const { box } = node
  const asset = photo.asset
  const mask = asset.maskScreen ?? asset.screen
  const screen = node.screen
  const maskStyle: React.CSSProperties = {
    WebkitMaskImage: `url(${asset.maskSrc})`,
    maskImage: `url(${asset.maskSrc})`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: `${mask.width * box.width}px ${mask.height * box.height}px`,
    maskSize: `${mask.width * box.width}px ${mask.height * box.height}px`,
    WebkitMaskPosition: `${(mask.x - asset.screen.x) * box.width}px ${(mask.y - asset.screen.y) * box.height}px`,
    maskPosition: `${(mask.x - asset.screen.x) * box.width}px ${(mask.y - asset.screen.y) * box.height}px`,
  }
  return (
    <>
      <div
        data-store-device-screen=""
        style={{
          position: 'absolute',
          left: screen.x,
          top: screen.y,
          width: screen.width,
          height: screen.height,
          overflow: 'hidden',
          background: '#000',
          ...maskStyle,
        }}
      >
        <ScreenContent node={node} screen={screen} resolveAsset={resolveAsset} />
      </div>
      <img
        src={asset.src}
        alt=""
        draggable={false}
        decoding="sync"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none', pointerEvents: 'none' }}
      />
    </>
  )
}

function ProceduralFrame({
  node,
  resolveAsset,
}: {
  node: SceneDevice
  resolveAsset: AssetResolver
}): React.JSX.Element {
  const { box, geometry, finish, frame } = node
  const parts = geometry.parts
  const clay = frame.style === 'clay'
  const frameless = frame.style === 'frameless' || frame.style === 'screen-only'
  const glass = node.model.family === 'headset'
  const body = parts?.body ?? { x: 0, y: 0, width: 1, height: 1 }
  const bodyPx = partStyle(body, box)
  const bodyShort = Math.min(Number(bodyPx.width), Number(bodyPx.height))
  const screen = node.screen
  const screenShort = Math.min(screen.width, screen.height)
  const bodyColor = clay ? shade(finish.body, 0.35) : finish.body
  const bodyFill = glass
    ? 'linear-gradient(160deg, rgba(255,255,255,0.55), rgba(255,255,255,0.18))'
    : clay
      ? bodyColor
      : `linear-gradient(135deg, ${shade(finish.body, 0.18)} 0%, ${finish.body} 38%, ${finish.edge} 100%)`
  const accessory = (part: FramePart | null | undefined, key: string, radius: number, fill: string) =>
    part ? (
      <div key={key} aria-hidden="true" style={{ ...partStyle(part, box), borderRadius: radius, background: fill }} />
    ) : null

  return (
    <>
      {parts?.bands.map((band, index) =>
        accessory(band, `band-${index}`, Number(partStyle(band, box).width) * 0.18, clay ? shade(bodyColor, -0.08) : shade(finish.edge, -0.15))
      )}
      {accessory(parts?.crown, 'crown', bodyShort * 0.05, clay ? bodyColor : finish.edge)}
      {accessory(parts?.base, 'base', Number(partStyle(parts?.base ?? body, box).height) * 0.45, clay ? shade(bodyColor, -0.05) : `linear-gradient(180deg, ${shade(finish.body, 0.2)}, ${finish.edge})`)}
      {!frameless ? (
        <div
          aria-hidden="true"
          style={{
            ...bodyPx,
            borderRadius: geometry.bodyRadius * bodyShort,
            background: bodyFill,
            boxShadow: glass
              ? 'inset 0 0 0 1.5px rgba(255,255,255,0.65)'
              : clay
                ? `inset 0 0 ${bodyShort * 0.02}px rgba(0,0,0,0.12)`
                : `inset 0 0 0 ${Math.max(1, bodyShort * 0.006)}px ${shade(finish.edge, -0.25)}, inset 0 0 0 ${Math.max(2, bodyShort * 0.014)}px ${shade(finish.body, 0.25)}`,
            backdropFilter: glass ? 'blur(12px)' : undefined,
          }}
        />
      ) : null}
      {accessory(parts?.grabber, 'grabber', box.width, 'rgba(255,255,255,0.7)')}
      <div
        data-store-device-screen=""
        style={{
          position: 'absolute',
          left: screen.x,
          top: screen.y,
          width: screen.width,
          height: screen.height,
          overflow: 'hidden',
          borderRadius: geometry.screenRadius * screenShort,
          background: '#000',
          boxShadow: frameless ? `0 0 0 ${Math.max(1, screenShort * 0.004)}px rgba(0,0,0,0.12)` : undefined,
        }}
      >
        <ScreenContent node={node} screen={screen} resolveAsset={resolveAsset} />
        <Cutout node={node} screen={screen} />
      </div>
    </>
  )
}

/** One device node. `slideWidth` scales the drop shadow. */
export const DeviceView = React.memo(function DeviceView({
  node,
  resolveAsset,
  slideWidth,
}: {
  node: SceneDevice
  resolveAsset: AssetResolver
  slideWidth: number
}): React.JSX.Element {
  const { box } = node
  const unit = slideWidth / 100
  const shadow = node.shadow
  const photo = node.geometry.parts === null && node.frame.style !== 'screen-only' && photoFrameFor(node.frame)
  return (
    <div
      data-store-layer={node.layerId}
      data-store-layer-type="device"
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          filter:
            shadow > 0
              ? `drop-shadow(0 ${(1.1 + shadow / 55) * unit}px ${(1.4 + shadow / 20) * unit}px rgba(0,0,0,${0.16 + shadow / 250}))`
              : undefined,
        }}
      >
        {photo ? (
          <PhotoFrame node={node} resolveAsset={resolveAsset} />
        ) : (
          <ProceduralFrame node={node} resolveAsset={resolveAsset} />
        )}
      </div>
    </div>
  )
})
