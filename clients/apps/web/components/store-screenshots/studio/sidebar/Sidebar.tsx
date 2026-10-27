'use client'

import * as React from 'react'
import { z } from 'zod'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LayersPanel } from './LayersPanel'
import { InsertPanel, LanguagesPanel, StylePanel } from './SidebarPanels'

/** Sidebar tabs. */
export const sidebarTabSchema = z.enum(['layers', 'insert', 'style', 'languages'])

/** A sidebar tab. */
export type SidebarTab = z.infer<typeof sidebarTabSchema>

const TABS: Record<SidebarTab, string> = { layers: 'Layers', insert: 'Insert', style: 'Style', languages: 'Languages' }

/** The left sidebar: navigation and project-level tools. Slide and layer properties live in the inspector. */
export function Sidebar(): React.JSX.Element {
  return (
    <Tabs defaultValue="layers" className="gap-0" asChild>
      <aside aria-label="Tools" className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden border-r border-foreground/10 bg-background">
        <TabsList aria-label="Sidebar" className="grid h-auto w-full shrink-0 grid-cols-4 gap-0.5 rounded-none border-b border-foreground/10 bg-transparent p-1.5">
          {sidebarTabSchema.options.map((item) => (
            <TabsTrigger
              key={item}
              value={item}
              className="h-7 rounded-md border-0 px-0 text-[11px] font-medium data-[state=active]:bg-foreground/[0.1] data-[state=active]:shadow-none"
            >
              {TABS[item]}
            </TabsTrigger>
          ))}
        </TabsList>
        {sidebarTabSchema.options.map((item) => (
          <TabsContent key={item} value={item} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {item === 'layers' ? <LayersPanel /> : item === 'insert' ? <InsertPanel /> : item === 'style' ? <StylePanel /> : <LanguagesPanel />}
          </TabsContent>
        ))}
      </aside>
    </Tabs>
  )
}
