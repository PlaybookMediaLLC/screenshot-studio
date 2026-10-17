'use client'

import * as React from 'react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { LayersPanel } from './LayersPanel'
import { InsertPanel, LanguagesPanel, StylePanel } from './SidebarPanels'

/** Sidebar tabs. */
export const sidebarTabSchema = z.enum(['layers', 'insert', 'style', 'languages'])

/** A sidebar tab. */
export type SidebarTab = z.infer<typeof sidebarTabSchema>

const TABS: Record<SidebarTab, string> = { layers: 'Layers', insert: 'Insert', style: 'Style', languages: 'Languages' }

/** The left sidebar: navigation and project-level tools. Slide and layer properties live in the inspector. */
export function Sidebar(): React.JSX.Element {
  const [tab, setTab] = React.useState<SidebarTab>('layers')
  return (
    <aside aria-label="Tools" className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden border-r border-foreground/10 bg-background">
      <div role="tablist" aria-label="Sidebar" className="grid shrink-0 grid-cols-4 gap-0.5 border-b border-foreground/10 p-1.5">
        {sidebarTabSchema.options.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`sidebar-tab-${item}`}
            aria-selected={tab === item}
            aria-controls={`sidebar-panel-${item}`}
            onClick={() => setTab(item)}
            className={cn('h-7 rounded-md text-[11px] font-medium', tab === item ? 'bg-foreground/[0.1] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground')}
          >
            {TABS[item]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`sidebar-panel-${tab}`} aria-labelledby={`sidebar-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'layers' ? <LayersPanel /> : tab === 'insert' ? <InsertPanel /> : tab === 'style' ? <StylePanel /> : <LanguagesPanel />}
      </div>
    </aside>
  )
}
