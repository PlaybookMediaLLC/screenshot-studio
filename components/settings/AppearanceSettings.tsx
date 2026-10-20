'use client'

import { Group, Row } from '@/components/platform-ui'
import { ChoiceGroup, SaveStatus, useSaveState } from '@/components/settings/controls'
import { type Preferences, usePreferences } from '@/components/settings/PreferencesProvider'
import { Switch } from '@/components/ui/switch'

/**
 * Appearance (RFC 043): how Shots looks to you, on every device you sign in
 * on. Each choice applies at once and is kept only when the server confirms
 * it; if a save fails, the previous choice comes back.
 */
export function AppearanceSettings() {
  const { preferences, save, status } = usePreferences()
  const [themeState, runTheme] = useSaveState()
  const [navigationState, runNavigation] = useSaveState()
  const [weekState, runWeek] = useSaveState()
  const [directionState, runDirection] = useSaveState()
  const [scrollState, runScroll] = useSaveState()
  const disabled = status !== 'ready'

  if (status === 'error') {
    return (
      <p className="text-sm text-red-700 dark:text-red-300" role="alert">
        Your appearance settings could not be loaded. Reload the page to try again.
      </p>
    )
  }

  return (
    <div className="grid gap-6" aria-busy={status === 'loading'}>
      <ChoiceGroup<Preferences['theme']>
        choices={[
          { description: 'Dark text on light surfaces.', label: 'Light', value: 'light' },
          { description: 'Light text on dark surfaces.', label: 'Dark', value: 'dark' },
          { description: "Follows your computer's setting as it changes.", label: 'System', value: 'system' },
        ]}
        disabled={disabled}
        legend="Theme"
        name="theme"
        onChange={(theme) => void runTheme(() => save({ theme }))}
        status={themeState}
        value={preferences?.theme}
      />
      <p className="-mt-3 text-xs text-muted-foreground">
        The theme applies to drafts, settings, campaigns and the rest of the workspace. The screenshot editor
        keeps its dark canvas.
      </p>
      <ChoiceGroup<Preferences['navigation']>
        choices={[
          { description: 'Icons only; labels appear on hover.', label: 'Always compact', value: 'compact' },
          {
            description: 'Labels on wide screens, icons on narrow ones, with a button to open it for a moment.',
            label: 'Dynamic',
            value: 'dynamic',
          },
          { description: 'Icons and labels everywhere.', label: 'Always expanded', value: 'expanded' },
        ]}
        disabled={disabled}
        legend="Desktop navigation"
        name="navigation"
        onChange={(navigation) => void runNavigation(() => save({ navigation }))}
        status={navigationState}
        value={preferences?.navigation}
      />
      <ChoiceGroup<Preferences['weekStart']>
        choices={[
          { label: 'Monday', value: 'monday' },
          { label: 'Sunday', value: 'sunday' },
        ]}
        disabled={disabled}
        legend="Calendar starts on"
        name="week-start"
        onChange={(weekStart) => void runWeek(() => save({ weekStart }))}
        status={weekState}
        value={preferences?.weekStart}
      />
      <ChoiceGroup<Preferences['textDirection']>
        choices={[
          { description: 'For English, French, Japanese and most languages.', label: 'Left to right', value: 'ltr' },
          { description: 'For Arabic, Hebrew, Persian and Urdu.', label: 'Right to left', value: 'rtl' },
        ]}
        disabled={disabled}
        legend="Editor text direction"
        name="text-direction"
        onChange={(textDirection) => void runDirection(() => save({ textDirection }))}
        status={directionState}
        value={preferences?.textDirection}
      />
      <Group>
        <Row
          description="Hidden scrollbars still scroll with a wheel, trackpad, touch or keyboard. Safari shows the change after you reload the page."
          label="Show scrollbars"
        >
          <div className="flex items-center gap-3">
            <SaveStatus state={scrollState} />
            <Switch
              aria-label="Show scrollbars"
              checked={preferences?.showScrollbars ?? true}
              disabled={disabled}
              onCheckedChange={(showScrollbars) => void runScroll(() => save({ showScrollbars }))}
            />
          </div>
        </Row>
      </Group>
    </div>
  )
}
