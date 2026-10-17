'use client'

import * as React from 'react'
import { z } from 'zod'

/**
 * Workspace-level actions that panels trigger but do not own: file pickers,
 * dialogs, and imports. The studio shell provides the implementations.
 */

/** Dialogs the studio can open. */
export const studioDialogSchema = z.enum([
  'export',
  'preview',
  'checks',
  'projects',
  'versions',
  'shortcuts',
  'import',
  'animation',
  'publish',
  'review',
  'applyStyle',
  'translate',
  'copy',
  'brandKits',
  'templates',
  'saveTemplate',
  'resetSlide',
])

/** A studio dialog. */
export type StudioDialog = z.infer<typeof studioDialogSchema>

/** Actions available to panels. */
export type StudioActions = {
  /** Ask for an image and put it on a device (or import new slides when null). */
  chooseScreenshot: (device: { slideId: string; layerId: string } | null) => void
  /** Import dropped or chosen files: replace a device's screenshot, or add slides. */
  importFiles: (files: File[], device: { slideId: string; layerId: string } | null) => void
  /** Ask for an image and add it as a free image layer on the active slide. */
  chooseImageLayer: () => void
  /** Ask for an image and use it as the active slide background. */
  chooseBackgroundImage: () => void
  openDialog: (dialog: StudioDialog) => void
}

const ActionsContext = React.createContext<StudioActions | null>(null)

/** Provide studio actions. */
export const StudioActionsProvider = ActionsContext.Provider

/** Studio actions for panels. */
export function useStudioActions(): StudioActions {
  const context = React.useContext(ActionsContext)
  if (!context) throw new Error('useStudioActions must be used inside <StudioActionsProvider>.')
  return context
}
