'use client'

import { useEffect } from 'react'

/** Confirm before leaving a form with unsaved work, including campaign tabs. */
export function useUnsavedCampaignChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const destination = new URL(link.href)
      if (destination.pathname === location.pathname && destination.search === location.search)
        return
      if (!window.confirm('Leave without saving your changes?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', navigate, true)
    }
  }, [dirty])
}
