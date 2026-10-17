'use client'

import { z } from 'zod'
import { create } from 'zustand'

/**
 * The editor's panels, by what the user wants to do. The left panel builds
 * the composition; the right panel inspects what is selected. Panel state is
 * session-only: it is never saved with a design or undone.
 */

/** Left panel: what the composition is made of. */
export const composeTabSchema = z.enum(['design', 'frame', 'background', 'layers'])
/** A left-panel tab. */
export type ComposeTab = z.infer<typeof composeTabSchema>

/** Right panel: the selection's properties, its 3D transform, and motion. */
export const inspectorTabSchema = z.enum(['edit', 'transforms', 'motion'])
/** A right-panel tab. */
export type InspectorTab = z.infer<typeof inspectorTabSchema>

/** Any panel tab; the mobile sheet shows them all in one list. */
export type EditorPanelTab = ComposeTab | InspectorTab

/** Panel state and the one action that opens a tab wherever it lives. */
export interface EditorPanelsState {
  composeTab: ComposeTab
  inspectorTab: InspectorTab
  /** The tab the single mobile sheet shows. */
  mobileTab: EditorPanelTab
  showTab: (tab: EditorPanelTab) => void
}

/** Session state for the editor's panels. */
export const useEditorPanels = create<EditorPanelsState>()((set) => ({
  composeTab: composeTabSchema.enum.design,
  inspectorTab: inspectorTabSchema.enum.edit,
  mobileTab: composeTabSchema.enum.design,
  showTab: (tab) => {
    const compose = composeTabSchema.safeParse(tab)
    set(
      compose.success
        ? { composeTab: compose.data, mobileTab: tab }
        : { inspectorTab: inspectorTabSchema.parse(tab), mobileTab: tab }
    )
  },
}))
