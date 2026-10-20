'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Group, Row } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'

/** The browser's deferred install prompt (Chromium only). */
const installPromptSchema = z.object({
  prompt: z.function(),
  userChoice: z.promise(z.object({ outcome: z.enum(['accepted', 'dismissed']) })),
})

/**
 * Install (RFC 043): the ways Shots really can be installed. Shots is a web
 * app with a manifest, so Chromium browsers and Safari can give it its own
 * window and icon. There is no native desktop or mobile app, and this page
 * does not offer one.
 */
export function InstallSettings() {
  const installed = useMediaQuery('(display-mode: standalone)')
  const [prompt, setPrompt] = useState<z.infer<typeof installPromptSchema> | null>(null)
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | null>(null)

  useEffect(() => {
    const capture = (event: Event) => {
      const parsed = installPromptSchema.safeParse(event)
      if (!parsed.success) return
      event.preventDefault()
      setPrompt(parsed.data)
    }
    window.addEventListener('beforeinstallprompt', capture)
    return () => window.removeEventListener('beforeinstallprompt', capture)
  }, [])

  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    setOutcome((await prompt.userChoice).outcome)
    setPrompt(null)
  }

  return (
    <div className="grid gap-6">
      <Group>
        <Row
          description={
            installed
              ? 'You are using Shots as an installed app.'
              : prompt
                ? 'Your browser can install Shots in its own window, with an icon in your dock or start menu.'
                : 'Your browser has not offered to install Shots here. Use the steps below for your browser.'
          }
          label="This browser"
        >
          {installed ? null : (
            <Button disabled={!prompt} onClick={() => void install()} type="button">
              Install Shots
            </Button>
          )}
        </Row>
        {outcome ? (
          <Row
            description={outcome === 'accepted' ? 'Shots is installed.' : 'You can install it later from here.'}
            label="Install"
          />
        ) : null}
      </Group>
      <Group>
        <Row description="Open the menu (⋮), then Cast, save and share → Install page as app." label="Chrome or Edge on a computer" />
        <Row description="Choose File → Add to Dock (Safari 17 or later on macOS Sonoma)." label="Safari on a Mac" />
        <Row description="Tap Share, then Add to Home Screen." label="iPhone or iPad (Safari)" />
        <Row description="Open the menu (⋮), then Install app or Add to Home screen." label="Android (Chrome)" />
        <Row description="Firefox does not install web apps on a computer. Pin the tab to keep Shots open." label="Firefox" />
      </Group>
      <p className="text-sm text-muted-foreground">
        There is no native Mac, Windows, iOS or Android app. Installing from your browser gives Shots its own
        window and icon, and it stays up to date on its own.
      </p>
    </div>
  )
}
