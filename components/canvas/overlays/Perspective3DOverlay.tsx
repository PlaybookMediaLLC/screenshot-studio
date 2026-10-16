'use client';

import { getFrameImageStyle, type FrameConfig } from '../frames/Frame3DOverlay';
import type { MainChromeFrame } from '../html/HTMLMainImageLayer';
import { ChromeFrame } from '@/components/frames/ChromeFrame';
import { type ShadowConfig } from '../utils/shadow-utils';
import { type ImageFilters } from '@/lib/store';
import { imageFilterCss } from '@/lib/editor/image-adjustments'

export interface Perspective3DConfig {
  perspective: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  translateX: number;
  translateY: number;
  scale: number;
}

interface Perspective3DOverlayProps {
  has3DTransform: boolean;
  perspective3D: Perspective3DConfig;
  screenshot: {
    rotation: number;
    radius: number;
  };
  shadow: ShadowConfig;
  frame: FrameConfig;
  /** Browser or window chrome, drawn by the shared chrome renderer. */
  chrome?: MainChromeFrame | null;
  /** Chrome size multiplier (the header size setting). */
  chromeScale?: number;
  showFrame: boolean;
  framedW: number;
  framedH: number;
  frameOffset: number;
  windowPadding: number;
  windowHeader: number;
  eclipseBorder: number;
  imageScaledW: number;
  imageScaledH: number;
  groupCenterX: number;
  groupCenterY: number;
  canvasW: number;
  canvasH: number;
  image: HTMLImageElement;
  imageOpacity: number;
  imageFilters?: ImageFilters;
}

export function Perspective3DOverlay({
  has3DTransform,
  perspective3D,
  screenshot,
  shadow,
  frame,
  chrome,
  chromeScale = 1,
  showFrame,
  framedW,
  framedH,
  frameOffset,
  windowPadding,
  windowHeader,
  eclipseBorder: _eclipseBorder,
  imageScaledW,
  imageScaledH,
  groupCenterX,
  groupCenterY,
  canvasW,
  canvasH,
  image,
  imageOpacity,
  imageFilters,
}: Perspective3DOverlayProps) {
  if (!has3DTransform) return null;

  const imageFilterStyle = imageFilterCss(imageFilters);

  const perspective3DTransform = `
    translate(${perspective3D.translateX}%, ${perspective3D.translateY}%)
    scale(${perspective3D.scale})
    rotateX(${perspective3D.rotateX}deg)
    rotateY(${perspective3D.rotateY}deg)
    rotateZ(${perspective3D.rotateZ + screenshot.rotation}deg)
  `
    .replace(/\s+/g, ' ')
    .trim();

  // Parse shadow color and extract RGB values
  const colorMatch = shadow.color.match(/rgba?\(([^)]+)\)/)
  let r = 0, g = 0, b = 0;

  if (colorMatch) {
    const parts = colorMatch[1].split(',').map(s => s.trim())
    r = parseInt(parts[0]) || 0;
    g = parseInt(parts[1]) || 0;
    b = parseInt(parts[2]) || 0;
  } else if (shadow.color.startsWith('#')) {
    const hex = shadow.color.replace('#', '')
    r = parseInt(hex.slice(0, 2), 16) || 0;
    g = parseInt(hex.slice(2, 4), 16) || 0;
    b = parseInt(hex.slice(4, 6), 16) || 0;
  }

  // Build shadow filter using direct values from store
  const buildShadowFilter = () => {
    const x = shadow.enabled ? (shadow.offsetX ?? 0) : 0;
    const y = shadow.enabled ? (shadow.offsetY ?? 0) : 0;
    const blur = shadow.enabled ? ((shadow.softness || 15) + (shadow.spread || 0)) : 15;
    const opacity = shadow.enabled ? Math.min(1, shadow.intensity) : 0.5;

    const shadows = [
      `drop-shadow(${x}px ${y}px ${blur}px rgba(${r}, ${g}, ${b}, ${opacity}))`,
      `drop-shadow(0px 0px ${blur * 0.5}px rgba(${r}, ${g}, ${b}, ${opacity * 0.2}))`,
    ];

    return shadows.join(' ');
  };

  const shadowFilter = buildShadowFilter();

  const isArcFrame = frame.type === 'arc-light' || frame.type === 'arc-dark';
  const isStyleFrame = ['glass-light', 'glass-dark', 'outline-light', 'border-light', 'border-dark'].includes(frame.type);

  const browserRadius = screenshot.radius;

  // Get frame container background color
  const getFrameBackground = () => {
    if (isStyleFrame) {
      const styleMap: Record<string, string> = {
        'glass-light': `rgba(255, 255, 255, ${frame.opacity ?? 0.25})`,
        'glass-dark': `rgba(0, 0, 0, ${frame.opacity ?? 0.3})`,
        'outline-light': `rgba(255, 255, 255, ${frame.opacity ?? 0.35})`,
        'border-light': 'rgb(255, 255, 255)',
        'border-dark': 'rgb(26, 26, 26)',
      };
      return styleMap[frame.type] || 'transparent';
    }
    return 'transparent';
  };

  const image3D = (
    <img
      src={image.src}
      alt="3D transformed"
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        objectFit: 'cover',
        opacity: imageOpacity,
        filter: imageFilterStyle,
      }}
    />
  );

  return (
    <div
      data-3d-overlay="true"
      data-untransformed-x={groupCenterX - framedW / 2}
      data-untransformed-y={groupCenterY - framedH / 2}
      data-untransformed-width={framedW}
      data-untransformed-height={framedH}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${canvasW}px`,
        height: `${canvasH}px`,
        perspective: `${perspective3D.perspective}px`,
        transformStyle: 'preserve-3d',
        zIndex: 15,
        pointerEvents: 'none',
        overflow: 'hidden',
        clipPath: `inset(0 0 0 0)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${groupCenterX - framedW / 2}px`,
          top: `${groupCenterY - framedH / 2}px`,
          width: `${framedW}px`,
          height: `${framedH}px`,
          transform: perspective3DTransform,
          transformOrigin: 'center center',
          willChange: 'transform',
          transition: 'transform 0.125s linear',
          filter: shadowFilter,
          opacity: 1,
        }}
      >
        {showFrame && chrome ? (
          <ChromeFrame frame={chrome} height={framedH} radius={browserRadius} scale={chromeScale} tone={chrome.tone} width={framedW}>
            {image3D}
          </ChromeFrame>
        ) : (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            backgroundColor: isStyleFrame ? getFrameBackground() : 'transparent',
            borderRadius: (isArcFrame || isStyleFrame) ? `${isStyleFrame ? (screenshot.radius > 0 ? screenshot.radius + windowPadding : 0) : browserRadius}px` : undefined,
            overflow: 'hidden',
          }}
        >
          <img
            src={image.src}
            alt="3D transformed"
            style={{
              position: 'absolute',
              left: `${frameOffset + windowPadding}px`,
              top: `${frameOffset + windowPadding + windowHeader}px`,
              width: `${imageScaledW}px`,
              height: `${imageScaledH}px`,
              objectFit: 'cover',
              opacity: imageOpacity,
              filter: imageFilterStyle,
              borderRadius: `${screenshot.radius}px`,
              // Apply frame border directly to image (arc, polaroid)
              ...(showFrame && getFrameImageStyle(frame, screenshot.radius)),
            }}
          />
        </div>
        )}
      </div>
    </div>
  );
}
