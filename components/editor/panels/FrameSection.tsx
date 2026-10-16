'use client'

import * as React from 'react'
import { Globe02Icon, Image01Icon, SmartPhone01Icon } from 'hugeicons-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useImageStore } from '@/lib/store'
import { BrowserMockupSection, DeviceFramesSection, StyleSection } from '../sections'

const FRAME_KINDS = [
  {
    description: 'The screenshot on its own, with an optional border style.',
    icon: <Image01Icon size={14} />,
    id: 'screenshot',
    label: 'Style',
  },
  {
    description: 'The screenshot inside a browser window with its address bar.',
    icon: <Globe02Icon size={14} />,
    id: 'browser',
    label: 'Browser',
  },
  {
    description: 'The screenshot on the screen of phones, tablets, laptops, and displays.',
    icon: <SmartPhone01Icon size={14} />,
    id: 'device',
    label: 'Device',
  },
] as const

type FrameKind = (typeof FRAME_KINDS)[number]['id']

/**
 * What holds the screenshot. Choosing a frame here is the only way to
 * switch between a plain screenshot, a browser window, and devices, so the
 * frame and its options live in one place.
 */
export function FrameSection() {
  const editorMode = useImageStore((state) => state.editorMode)
  const setEditorMode = useImageStore((state) => state.setEditorMode)
  const current = FRAME_KINDS.find((kind) => kind.id === editorMode) ?? FRAME_KINDS[0]

  return (
    <div className="space-y-3">
      <SegmentedControl
        onChange={(id) => setEditorMode(id as FrameKind)}
        options={FRAME_KINDS.map((kind) => ({
          ariaLabel: `${kind.label} frame`,
          icon: kind.icon,
          id: kind.id,
          label: kind.label,
        }))}
        value={editorMode}
      />
      <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{current.description}</p>
      <div className="space-y-1">
        {editorMode === 'device' ? (
          <DeviceFramesSection />
        ) : editorMode === 'browser' ? (
          <BrowserMockupSection />
        ) : (
          <StyleSection />
        )}
      </div>
    </div>
  )
}
