'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { useSaveState } from '@/components/settings/controls'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const subscribe = () => () => {}

/** Changes the workspace theme and saves it to the signed-in account. */
export function ThemeToggle() {
  const { resolvedTheme } = useTheme()
  const { save, status } = usePreferences()
  const [state, run] = useSaveState()
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
  const next = hydrated && resolvedTheme === 'light' ? 'dark' : 'light'
  const label = `Switch to ${next} mode`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-busy={state === 'saving'}
          disabled={status !== 'ready' || state === 'saving'}
          onClick={() => void run(() => save({ theme: next }))}
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
        >
          <Sun aria-hidden="true" className="hidden dark:block" />
          <Moon aria-hidden="true" className="dark:hidden" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
