'use client'

import * as React from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { type EditorPanelTab, useEditorPanels } from '@/lib/store/editor-panels'
import { COMPOSE_TABS, INSPECTOR_TABS, type PanelTabDefinition, PanelTabContent } from './panel-tabs'
import { Button } from '@/components/ui/button'

/** A side panel: one row of tabs and the active tab's content. */
function SidePanel<Tab extends EditorPanelTab>({
  active,
  className,
  label,
  tabs,
}: {
  active: Tab
  className?: string
  label: string
  tabs: readonly PanelTabDefinition<Tab>[]
}) {
  const showTab = useEditorPanels((state) => state.showTab)
  return (
    <aside
      aria-label={label}
      className={cn('relative flex h-full w-[260px] shrink-0 flex-col overflow-hidden bg-background', className)}
    >
      <div className="shrink-0 border-b border-foreground/10 px-3 py-2.5">
        <SegmentedControl
          onChange={(id) => showTab(id as Tab)}
          // Four labelled tabs only fit the panel without icons.
          options={tabs.map((tab) => ({
            ariaLabel: tab.label,
            icon: tabs.length > 3 ? undefined : tab.icon,
            id: tab.id,
            label: tab.label,
            tooltip: tab.hint,
          }))}
          value={active}
        />
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <PanelTabContent active={active} tabs={tabs} />
      </div>
    </aside>
  )
}

/** Left panel: Design, Frame, Background, Layers. */
export function ComposePanel() {
  const active = useEditorPanels((state) => state.composeTab)
  return (
    <SidePanel active={active} className="border-r border-foreground/10" label="Compose" tabs={COMPOSE_TABS} />
  )
}

/** Right panel: the selection's properties, 3D, and Motion. */
export function InspectorPanel() {
  const active = useEditorPanels((state) => state.inspectorTab)
  return (
    <SidePanel active={active} className="border-l border-foreground/10" label="Inspector" tabs={INSPECTOR_TABS} />
  )
}

const ALL_TABS: readonly PanelTabDefinition<EditorPanelTab>[] = [...COMPOSE_TABS, ...INSPECTOR_TABS]

/** Phones: every tab of both panels in one sheet, labelled. */
export function MobilePanel({ onClose }: { onClose?: () => void }) {
  const active = useEditorPanels((state) => state.mobileTab)
  const showTab = useEditorPanels((state) => state.showTab)
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-foreground/10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
          <SegmentedControl
            onChange={(id) => showTab(id as EditorPanelTab)}
            options={ALL_TABS.map((tab) => ({ ariaLabel: tab.label, icon: tab.icon, id: tab.id, label: tab.label }))}
            size="sm"
            value={active}
          />
        </div>
        {onClose ? (
          <Button variant="custom" size={null}
            aria-label="Close settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            ×
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-hide">
        <PanelTabContent active={active} tabs={ALL_TABS} />
      </div>
    </div>
  )
}
