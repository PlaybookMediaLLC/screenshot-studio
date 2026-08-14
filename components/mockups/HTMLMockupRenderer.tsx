'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useImageStore } from '@/lib/store';
import { getMockupDefinition } from '@/lib/constants/mockups';
import type { Mockup } from '@/types/mockup';

interface HTMLMockupRendererProps {
  mockup: Mockup;
}

export function HTMLMockupRenderer({ mockup }: HTMLMockupRendererProps) {
  const { uploadedImageUrl, updateMockup } = useImageStore();
  const definition = getMockupDefinition(mockup.definitionId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mockupSize, setMockupSize] = useState({ width: 0, height: 0 });
  const [mockupLoaded, setMockupLoaded] = useState(false);

  // Calculate mockup dimensions
  const handleMockupLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const mockupAspectRatio = img.naturalWidth / img.naturalHeight;
    const mockupWidth = mockup.size;
    const mockupHeight = mockupWidth / mockupAspectRatio;
    setMockupSize({ width: mockupWidth, height: mockupHeight });
    setMockupLoaded(true);
  }, [mockup.size]);

  // Calculate screen area dimensions
  const screenArea = definition?.screenArea;
  const screenAreaX = (screenArea?.x ?? 0) * mockupSize.width;
  const screenAreaY = (screenArea?.y ?? 0) * mockupSize.height;
  const screenAreaWidth = (screenArea?.width ?? 0) * mockupSize.width;
  const screenAreaHeight = (screenArea?.height ?? 0) * mockupSize.height;
  const borderRadius = (screenArea?.borderRadius ?? 0) * mockupSize.width;

  // Handle drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - mockup.position.x,
      y: e.clientY - mockup.position.y,
    });
  }, [mockup.position.x, mockup.position.y]);

  useEffect(() => {
    if (!definition || !isDragging || !mockup.isVisible) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      updateMockup(mockup.id, { position: { x: newX, y: newY } });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [definition, isDragging, dragStart, mockup.id, mockup.isVisible, updateMockup]);

  if (!definition || !mockup.isVisible) return null;

  return (
    <div
      ref={containerRef}
      data-mockup-id={mockup.id}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: `${mockup.position.x}px`,
        top: `${mockup.position.y}px`,
        width: mockupLoaded ? `${mockupSize.width}px` : 'auto',
        height: mockupLoaded ? `${mockupSize.height}px` : 'auto',
        transform: `rotate(${mockup.rotation}deg)`,
        transformOrigin: 'center center',
        opacity: mockup.opacity,
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      {/* Mockup frame image */}
      <img
        src={definition.src}
        alt={definition.name}
        draggable={false}
        onLoad={handleMockupLoad}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          position: 'relative',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />

      {/* User image clipped to screen area */}
      {uploadedImageUrl && mockupLoaded && (
        <div
          style={{
            position: 'absolute',
            left: `${screenAreaX}px`,
            top: `${screenAreaY}px`,
            width: `${screenAreaWidth}px`,
            height: `${screenAreaHeight}px`,
            borderRadius: `${borderRadius}px`,
            overflow: 'hidden',
            zIndex: 1,
          }}
        >
          <img
            src={uploadedImageUrl}
            alt="User content"
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: mockup.imageFit || 'cover',
              display: 'block',
            }}
          />
        </div>
      )}
    </div>
  );
}
