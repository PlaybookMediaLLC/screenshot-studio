'use client';

import type { ImageBorder } from '@/lib/store';

export interface FrameConfig {
  enabled: boolean;
  type: ImageBorder['type'];
  width: number;
  color: string;
  padding?: number;
  title?: string;
  opacity?: number;
}

/**
 * Returns CSS styles for frames to be applied directly to the image element.
 * This ensures the border wraps the image properly with overflow:hidden.
 */
export function getFrameImageStyle(
  frame: FrameConfig,
  screenshotRadius: number
): React.CSSProperties | null {
  const arcBorderWidth = frame.width || 8;

  switch (frame.type) {
    case 'arc-light': {
      const lightOpacity = frame.opacity ?? 0.5;
      return {
        border: `${arcBorderWidth}px solid rgba(255, 255, 255, ${lightOpacity})`,
        borderRadius: `${screenshotRadius}px`,
        overflow: 'hidden',
        boxSizing: 'border-box',
      };
    }

    case 'arc-dark': {
      const darkOpacity = frame.opacity ?? 0.7;
      return {
        border: `${arcBorderWidth}px solid rgba(0, 0, 0, ${darkOpacity})`,
        borderRadius: `${screenshotRadius}px`,
        overflow: 'hidden',
        boxSizing: 'border-box',
      };
    }

    case 'photograph':
      // Polaroid style: 8px top/sides, 24px bottom
      return {
        borderWidth: '8px 8px 24px 8px',
        borderStyle: 'solid',
        borderColor: 'white',
        borderRadius: '8px',
        overflow: 'hidden',
        boxSizing: 'border-box',
      };

    default:
      return null;
  }
}
