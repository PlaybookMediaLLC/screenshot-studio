'use client';

import { SAFE_ZONES, safeZoneRect } from '@/lib/editor/snapping';
import { useCanvasGuides } from '@/lib/store/canvas-guides';

const LINE = 'rgba(59, 130, 246, 0.55)';

/**
 * Composition guides drawn over the canvas: rule-of-thirds lines and a
 * platform's safe zone, with the area its UI covers shaded. Left out of
 * exports unless the user asks for guides in exports.
 */
export function CanvasGuidesLayer({ canvasW, canvasH }: { canvasW: number; canvasH: number }) {
  const { guidesInExport, safeZone, showThirds } = useCanvasGuides();
  if (!showThirds && safeZone === 'none') return null;
  const safe = safeZone === 'none' ? null : safeZoneRect(safeZone, canvasW, canvasH);
  return (
    <div
      aria-hidden
      data-export-exclude={guidesInExport ? undefined : 'true'}
      data-canvas-guides="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 255 }}
    >
      {showThirds
        ? [1, 2].map((third) => (
            <div key={third}>
              <div style={{ position: 'absolute', left: (canvasW * third) / 3, top: 0, bottom: 0, borderLeft: `1px solid ${LINE}` }} />
              <div style={{ position: 'absolute', top: (canvasH * third) / 3, left: 0, right: 0, borderTop: `1px solid ${LINE}` }} />
            </div>
          ))
        : null}
      {safe && safeZone !== 'none' ? (
        <div
          style={{
            position: 'absolute',
            left: safe.x,
            top: safe.y,
            width: safe.width,
            height: safe.height,
            border: '1px dashed rgba(250, 204, 21, 0.9)',
            boxShadow: '0 0 0 400vmax rgba(250, 204, 21, 0.12)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 6,
              top: 4,
              fontSize: 10,
              fontFamily: 'system-ui, sans-serif',
              color: 'rgba(250, 204, 21, 1)',
              textShadow: '0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            {SAFE_ZONES[safeZone].label} safe area
          </span>
        </div>
      ) : null}
    </div>
  );
}
