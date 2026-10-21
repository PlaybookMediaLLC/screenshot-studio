'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import {
  DEFAULT_EXPORT_SETTINGS,
  loadExportSettings,
  saveExportSettings,
  type ExportSettings,
} from './export-settings'

const useSettings = create<{
  settings: ExportSettings
  update: (change: Partial<ExportSettings>) => void
}>((set) => ({
  settings: DEFAULT_EXPORT_SETTINGS,
  update: (change) =>
    set((state) => {
      const settings = { ...state.settings, ...change }
      saveExportSettings(window.localStorage, settings)
      return { settings }
    }),
}))
let loaded = false

/** Shared export preferences, so the toolbar can show transparency even with the menu closed. */
export function useExportSettings(): [ExportSettings, (change: Partial<ExportSettings>) => void] {
  const { settings, update } = useSettings()
  useEffect(() => {
    if (loaded) return
    loaded = true
    useSettings.setState({ settings: loadExportSettings(window.localStorage) })
  }, [])
  return [settings, update]
}
