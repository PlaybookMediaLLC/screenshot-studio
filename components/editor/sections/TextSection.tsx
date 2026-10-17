'use client';

import * as React from 'react';
import { SectionWrapper } from './SectionWrapper';
import { TextLayerList } from '@/components/text-overlay/text-overlay-controls';

export function TextSection() {
  return (
    <SectionWrapper title="Text" defaultOpen={true}>
      <TextLayerList />
    </SectionWrapper>
  );
}
