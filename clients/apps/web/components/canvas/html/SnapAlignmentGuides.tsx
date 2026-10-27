'use client';

import { useActiveSnapGuides } from '@/lib/editor/snap-dom';

const GUIDE = 'rgba(59, 130, 246, 0.8)';

/** The lines the layer being dragged has snapped to. Never exported. */
export function SnapAlignmentGuides() {
  const { horizontal, vertical } = useActiveSnapGuides();
  if (horizontal === null && vertical === null) return null;
  return (
    <div
      data-export-exclude="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 260 }}
    >
      {vertical !== null && (
        <div style={{ position: 'absolute', left: vertical, top: 0, bottom: 0, borderLeft: `1px dashed ${GUIDE}` }} />
      )}
      {horizontal !== null && (
        <div style={{ position: 'absolute', top: horizontal, left: 0, right: 0, borderTop: `1px dashed ${GUIDE}` }} />
      )}
    </div>
  );
}
