import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import { chromeBoxForContent, type Insets } from "@/lib/frames/geometry";
import type { FrameChrome } from "@/lib/frames/schema";

export interface CanvasDimensions {
  canvasW: number;
  canvasH: number;
  contentW: number;
  contentH: number;
  imageScaledW: number;
  imageScaledH: number;
  framedW: number;
  framedH: number;
  frameOffset: number;
  windowPadding: number;
  windowHeader: number;
  /** Browser or window chrome around the image; the top equals `windowHeader`. */
  chromeInsets: Insets;
  eclipseBorder: number;
  groupCenterX: number;
  groupCenterY: number;
  imageX: number;
  imageY: number;
}

export function calculateCanvasDimensions(
  image: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight'>,
  containerWidth: number,
  containerHeight: number,
  viewportSize: { width: number; height: number },
  canvas: { padding: number },
  screenshot: {
    scale: number;
    offsetX: number;
    offsetY: number;
    radius: number;
  },
  frame: {
    enabled: boolean;
    type: string;
    width: number;
    padding?: number;
  },
  browserHeaderSize?: number,
  /** The main screenshot's browser or window chrome, when it has one. */
  chrome?: { kind: "browser" | "window"; chrome: FrameChrome } | null
): CanvasDimensions {
  const imageAspect = image.naturalWidth / image.naturalHeight;
  const isMobileViewport = viewportSize.width < MOBILE_BREAKPOINT;

  // Stage footprint is locked to the responsive container so empty → loaded
  // never changes size. Padding only insets the screenshot content area.
  const canvasW = containerWidth;
  const canvasH = containerHeight;

  // Adapt padding so small canvases don't end up with huge borders.
  const maxPaddingRatio = isMobileViewport ? 0.05 : 0.08;
  const paddingLimit = Math.min(
    canvas.padding,
    Math.min(canvasW, canvasH) * maxPaddingRatio
  );
  const appliedPadding = Math.max(0, paddingLimit);

  const contentW = Math.max(0, canvasW - appliedPadding * 2);
  const contentH = Math.max(0, canvasH - appliedPadding * 2);

  let imageScaledW: number, imageScaledH: number;
  if (contentW / contentH > imageAspect) {
    imageScaledH = contentH * screenshot.scale;
    imageScaledW = imageScaledH * imageAspect;
  } else {
    imageScaledW = contentW * screenshot.scale;
    imageScaledH = imageScaledW / imageAspect;
  }

  const showFrame = frame.enabled && frame.type !== 'none';

  if (showFrame) {
    imageScaledW *= 0.88;
    imageScaledH *= 0.88;
  }

  const isPhotograph = frame.type === 'photograph';
  const isStyleFrame = ['glass-light', 'glass-dark', 'outline-light', 'border-light', 'border-dark'].includes(frame.type);

  // No frameOffset - borders are applied directly to image elements
  const frameOffset = 0;

  // Calculate style frame padding from store value (percentage of image width)
  let stylePadding = 0;
  if (showFrame && isStyleFrame) {
    const paddingPct = (frame.padding ?? 2) / 100;
    stylePadding = Math.round(imageScaledW * paddingPct);
  }

  // Polaroid needs padding for the white border (8px sides/top)
  // Style frames use their own calculated padding
  const windowPadding = showFrame && isPhotograph ? 8 : (showFrame && isStyleFrame ? stylePadding : 0);

  // Header/footer height:
  // - Browser and window chrome: proportional to the image, scaled by the header size
  // - Polaroid: 16px extra bottom (24px total bottom - 8px already in windowPadding)
  const chromeInsets = showFrame && chrome
    ? chromeBoxForContent(chrome.kind, chrome.chrome, { height: imageScaledH, width: imageScaledW }, (browserHeaderSize ?? 100) / 100).insets
    : { bottom: 0, left: 0, right: 0, top: 0 };
  const windowHeader = showFrame && chrome ? chromeInsets.top : (showFrame && isPhotograph ? 16 : 0);

  const eclipseBorder = 0;

  const framedW =
    imageScaledW + frameOffset * 2 + windowPadding * 2 + eclipseBorder + chromeInsets.left + chromeInsets.right;
  const framedH =
    imageScaledH +
    frameOffset * 2 +
    windowPadding * 2 +
    windowHeader +
    eclipseBorder +
    chromeInsets.bottom;

  const groupCenterX = canvasW / 2 + screenshot.offsetX;
  const groupCenterY = canvasH / 2 + screenshot.offsetY;
  const imageX = groupCenterX + frameOffset + windowPadding + chromeInsets.left - imageScaledW / 2;
  const imageY =
    groupCenterY +
    frameOffset +
    windowPadding +
    windowHeader -
    imageScaledH / 2;

  return {
    canvasW,
    canvasH,
    contentW,
    contentH,
    imageScaledW,
    imageScaledH,
    framedW,
    framedH,
    frameOffset,
    windowPadding,
    windowHeader,
    chromeInsets,
    eclipseBorder,
    groupCenterX,
    groupCenterY,
    imageX,
    imageY,
  };
}

/** A rectangle in stage px: top-left corner and size. */
export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the main image's pixels are drawn on the stage (before rotation and
 * 3D): inside its frame's padding and browser bar, at the layer's scale.
 */
export function mainImageRect(
  dimensions: Pick<CanvasDimensions, 'canvasW' | 'canvasH' | 'chromeInsets' | 'framedW' | 'framedH' | 'imageScaledW' | 'imageScaledH' | 'windowPadding' | 'windowHeader'>,
  screenshot: { offsetX: number; offsetY: number; scale: number },
  frameType: string
): StageRect {
  const scale = screenshot.scale;
  const centerX = dimensions.canvasW / 2 + screenshot.offsetX;
  const centerY = dimensions.canvasH / 2 + screenshot.offsetY;
  // Browser bars sit above the image; a photograph's extra margin is below it.
  const barAbove = frameType === 'photograph' ? 0 : dimensions.windowHeader;
  return {
    x: centerX - (dimensions.framedW * scale) / 2 + (dimensions.windowPadding + dimensions.chromeInsets.left) * scale,
    y: centerY - (dimensions.framedH * scale) / 2 + (dimensions.windowPadding + barAbove) * scale,
    width: dimensions.imageScaledW * scale,
    height: dimensions.imageScaledH * scale,
  };
}
