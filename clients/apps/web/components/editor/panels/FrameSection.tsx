'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { withHistoryStep } from '@/lib/store'
import { BrowserOptions, WindowOptions } from '@/components/frames/panels/ChromeOptions'
import { CompositionSection } from '@/components/frames/panels/CompositionSection'
import { DeviceOptions } from '@/components/frames/panels/DeviceOptions'
import { changeChrome, chooseFrame, type FrameChoice, useFrameTarget } from '@/components/frames/panels/frame-target'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { screenLabel } from '@/lib/frames/labels'
import { StyleSection } from '../sections'

const FRAME_CHOICES = [
  {
    description: 'The screenshot on its own, with an optional border style.',
    id: 'style',
    label: 'Style',
  },
  {
    description: 'Inside a browser: Safari, Chrome, Arc, Edge, or Firefox, with its tabs and address bar.',
    id: 'browser',
    label: 'Browser',
  },
  {
    description: 'Inside an app or terminal window on macOS or Windows.',
    id: 'window',
    label: 'Window',
  },
  {
    description: 'On the screen of a phone, tablet, laptop, desktop, watch, or Vision Pro.',
    id: 'device',
    label: 'Device',
  },
] as const satisfies readonly { id: FrameChoice; label: string; description: string }[]

/**
 * What holds the screenshot. In a composition the frame belongs to the
 * selected screen, or to every screen when none is selected; below it, the
 * composition's screens and layouts.
 */
export function FrameSection() {
  const target = useFrameTarget()
  const scopeKey = `${target.screens.map((screen) => screen.id).join(',')}:${target.choice}`
  const [browsing, setBrowsing] = useState<{ key: string; choice: FrameChoice } | null>(null)
  const choice = browsing?.key === scopeKey ? browsing.choice : target.choice
  const current = FRAME_CHOICES.find((item) => item.id === choice) ?? FRAME_CHOICES[0]
  const { screens } = target
  const mixed = !target.single && new Set(screens.map((screen) => screen.frame?.kind ?? 'device')).size > 1
  const scope =
    screens.length === 0
      ? 'the screenshot'
      : target.single || screens.length === 1
        ? screenLabel(screens[0]!).toLowerCase()
        : `all ${screens.length} screens`
  const onChange = (changes: Parameters<typeof changeChrome>[1]) => withHistoryStep(() => {
    if (choice !== target.choice) chooseFrame(target, choice)
    changeChrome(target, changes)
  })

  return (
    <div className="space-y-3">
      <p className="px-0.5 text-[11px] text-muted-foreground" data-frame-scope="true">
        Frame for <span className="font-medium text-foreground">{scope}</span>
      </p>
      <SegmentedControl
        ariaLabel="Frame"
        onChange={(id) => setBrowsing({ key: scopeKey, choice: id as FrameChoice })}
        options={FRAME_CHOICES.map((choice) => ({
          ariaLabel: `${choice.label} frame`,
          id: choice.id,
          label: choice.label,
          tooltip: choice.description,
        }))}
        value={choice}
      />
      <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
        {mixed ? 'These screens use different frames; a choice here applies to all of them.' : current.description}
      </p>
      {choice !== target.choice ? (
        <div className="space-y-2 rounded-md bg-foreground/[0.04] p-2.5 text-xs text-muted-foreground">
          <p>Browsing {current.label.toLowerCase()} frames. Choose an option to apply it.</p>
          {choice !== 'device' ? <Button size="sm" variant="outline" onClick={() => chooseFrame(target, choice)}>Apply {current.label.toLowerCase()} frame</Button> : null}
        </div>
      ) : null}
      <div className="space-y-1">
        {choice === 'device' ? (
          <DeviceOptions target={target} />
        ) : choice === 'browser' ? (
          <BrowserOptions chrome={target.chrome} onChange={onChange} />
        ) : choice === 'window' ? (
          <WindowOptions chrome={target.chrome} onChange={onChange} />
        ) : screens.length === 0 ? (
          <StyleSection />
        ) : (
          <p className="rounded-md bg-foreground/[0.04] px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
            No frame: the screenshot shows on its own with rounded corners and a soft shadow.
          </p>
        )}
      </div>
      <CompositionSection />
    </div>
  )
}
