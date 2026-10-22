'use client'

import { useEffect } from 'react'
import { registerNavigationGuard } from '@/lib/platform/navigation-guard'

let activeForms = 0
let removeListeners: (() => void) | undefined

/** Warn before leaving an edited settings form, including document reloads. */
export function useUnsavedSettings(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    activeForms++
    if (activeForms > 1)
      return () => {
        if (--activeForms === 0) removeListeners?.()
      }
    const message = 'You have unsaved changes. Leave this page without saving?'
    const removeGuard = registerNavigationGuard(() => {
      if (!window.confirm(message))
        throw new Error('Workspace switch cancelled. Save or discard the open settings first.')
    })
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    // Browsers with the Navigation API can also warn before Back/Forward.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    const navigate = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType !== 'traverse') return
      if (event.cancelable && !window.confirm(message)) event.preventDefault()
    }
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      )
        return
      const destination = new URL(link.href)
      if (destination.pathname === location.pathname && destination.search === location.search)
        return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    if (navigation) navigation.addEventListener('navigate', navigate)
    document.addEventListener('click', click, true)
    removeListeners = () => {
      removeGuard()
      window.removeEventListener('beforeunload', unload)
      navigation?.removeEventListener('navigate', navigate)
      document.removeEventListener('click', click, true)
    }
    return () => {
      if (--activeForms === 0) removeListeners?.()
    }
  }, [dirty])
}
