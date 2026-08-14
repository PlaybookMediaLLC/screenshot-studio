'use client';

import { HTMLMockupRenderer } from './HTMLMockupRenderer';
import type { Mockup } from '@/types/mockup';

interface MockupRendererProps {
  mockup: Mockup;
}

/**
 * Unified mockup renderer using HTML/CSS.
 * Supports all mockup types: iPhone, MacBook, iMac, iWatch.
 */
export function MockupRenderer({ mockup }: MockupRendererProps) {
  return <HTMLMockupRenderer mockup={mockup} />;
}
