'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { PaletteIcon as ColorsIcon } from '@phosphor-icons/react/dist/ssr/Palette'
import { StackIcon as LayersLogoIcon } from '@phosphor-icons/react/dist/ssr/Stack'
import { PaletteIcon as PaintBoardIcon } from '@phosphor-icons/react/dist/ssr/Palette'
import { SelectionIcon as RotateSquareIcon } from '@phosphor-icons/react/dist/ssr/Selection'
import { SlidersHorizontalIcon as SlidersHorizontalIcon } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal'
import { SquareIcon as SquareIcon } from '@phosphor-icons/react/dist/ssr/Square'
import { FilmScriptIcon as VideoReplayIcon } from '@phosphor-icons/react/dist/ssr/FilmScript'
import type { ComposeTab, EditorPanelTab, InspectorTab } from '@/lib/store/editor-panels'
import {
  AnnotateSection,
  BackgroundEffectsSection,
  BackgroundSection,
  DepthSection,
  ElementsSection,
  ImageOverlaySection,
  QuickTemplatesSection,
  ScreenshotDesignSection,
  TextSection,
  TransformsGallery,
} from '../sections'
import { AiBackgroundSection } from '../ai/AiBackgroundSection'
import { BrandSection } from '../brand/BrandSection'
import { PresetLibrarySection } from '../presets/PresetLibrarySection'
import { RedactSection } from '../redaction/RedactSection'
import { TypographySection } from '../typography/TypographySection'
import { FrameSection } from './FrameSection'
import { SelectionInspector } from './SelectionInspector'
import { PerspectiveSliders, TransformControls } from './transform-motion-controls'

const AnimationControls = dynamic(
  () => import('./transform-motion-controls').then((module) => module.AnimationControls),
  { ssr: false }
)

const MotionPanel = dynamic(
  () => import('../motion/MotionPanel').then((module) => module.MotionPanel),
  { ssr: false }
)

/** One panel tab: its label, icon, a hint for the tooltip, and what it shows. */
export type PanelTabDefinition<Tab extends EditorPanelTab> = {
  content: () => React.ReactNode
  hint: string
  icon: React.ReactNode
  id: Tab
  label: string
}

/** Left panel: build the composition. */
export const COMPOSE_TABS: readonly PanelTabDefinition<ComposeTab>[] = [
  {
    content: () => (
      <div className="space-y-1">
        <QuickTemplatesSection />
        <BrandSection />
        <PresetLibrarySection />
        <ScreenshotDesignSection />
        <TextSection />
        <TypographySection />
        <ElementsSection />
        <ImageOverlaySection />
        <AnnotateSection />
        <RedactSection />
      </div>
    ),
    hint: 'Templates, brand, presets, text, elements, stickers, markup, and redaction',
    icon: <PaintBoardIcon size={14} />,
    id: 'design',
    label: 'Design',
  },
  {
    content: () => <FrameSection />,
    hint: 'What holds the screenshot: a style, a browser, or a device',
    icon: <SquareIcon size={14} />,
    id: 'frame',
    label: 'Frame',
  },
  {
    content: () => (
      <div className="space-y-1">
        <BackgroundSection />
        <AiBackgroundSection />
        <BackgroundEffectsSection />
      </div>
    ),
    hint: 'Backgrounds, blur, grain, and patterns',
    icon: <ColorsIcon size={14} />,
    id: 'background',
    label: 'BG',
  },
  {
    content: () => <DepthSection />,
    hint: 'Every layer, its order and visibility',
    icon: <LayersLogoIcon size={14} />,
    id: 'layers',
    label: 'Layers',
  },
]

/** Right panel: inspect what is selected. */
export const INSPECTOR_TABS: readonly PanelTabDefinition<InspectorTab>[] = [
  {
    content: () => <SelectionInspector />,
    hint: 'Properties of the selection, or of the screenshot and canvas',
    icon: <SlidersHorizontalIcon size={14} />,
    id: 'edit',
    label: 'Edit',
  },
  {
    content: () => (
      <div className="space-y-1">
        <TransformControls />
        <div className="flex items-center gap-2 px-2 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Layout Presets
          </span>
        </div>
        <TransformsGallery />
        <PerspectiveSliders />
      </div>
    ),
    hint: '3D perspective and layout presets',
    icon: <RotateSquareIcon size={14} />,
    id: 'transforms',
    label: '3D',
  },
  {
    content: () => (
      <div className="space-y-1">
        <MotionPanel />
        <AnimationControls />
      </div>
    ),
    hint: 'Keyframes, reveals, scroll-through, audio, captions, and animation presets',
    icon: <VideoReplayIcon size={14} />,
    id: 'motion',
    label: 'Motion',
  },
]

/**
 * A panel's content with the editor's short cross-fade between tabs, so a
 * tab switch reads as a change of context rather than a jump.
 */
export function PanelTabContent<Tab extends EditorPanelTab>({
  active,
  tabs,
}: {
  active: Tab
  tabs: readonly PanelTabDefinition<Tab>[]
}) {
  const [shown, setShown] = React.useState(active)
  const [transitioning, setTransitioning] = React.useState(false)

  React.useEffect(() => {
    if (active === shown) return
    setTransitioning(true)
    const timeout = setTimeout(() => {
      setShown(active)
      setTransitioning(false)
    }, 150)
    return () => clearTimeout(timeout)
  }, [active, shown])

  const tab = tabs.find((candidate) => candidate.id === shown) ?? tabs[0]
  return (
    <div
      className="p-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
      role="tabpanel"
      aria-label={tab.label}
      style={{
        opacity: transitioning ? 0 : 1,
        transform: transitioning ? 'translateY(4px)' : 'translateY(0)',
      }}
    >
      {tab.content()}
    </div>
  )
}
