'use client'

import { Group, Row } from '@/components/platform-ui'
import { SaveStatus, useSaveState } from '@/components/settings/controls'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { useSocialSets } from '@/components/settings/social-sets/api'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { SettingsRequestError, settingsErrorMessage } from '@/lib/settings/client'

/** Kinds turned off per social set: set ID, then kind, false for off. */
export type SocialSetNotificationPreferences = Record<string, Record<string, boolean>>

/** The activity a person can turn off for one social set. */
const SET_KINDS = [
  { id: 'post.published', label: 'Post published' },
  { id: 'post.auto_repost_published', label: 'Auto-retweet published' },
  { id: 'post.auto_plug_published', label: 'Auto-plug published' },
  { id: 'post.publish_failed', label: 'Publishing needs attention' },
] as const

/**
 * The email master switch (RFC 043). It is a personal preference, so it holds
 * in every workspace; off, no activity email reaches you, while sign-in,
 * invitation and security messages still do.
 */
export function EmailSwitch() {
  const { preferences, save, status } = usePreferences()
  const [state, run] = useSaveState()
  return (
    <Group>
      <Row
        description="Off, no activity email reaches you from any workspace. Sign-in, invitation and security email still arrive."
        label="Email notifications"
      >
        <div className="flex items-center gap-3">
          <SaveStatus state={state} />
          <Switch
            aria-label="Email notifications"
            checked={preferences?.emailNotifications ?? true}
            disabled={status !== 'ready'}
            onCheckedChange={(emailNotifications) => void run(() => save({ emailNotifications }))}
          />
        </div>
      </Row>
      {status === 'error' ? (
        <p className="px-5 pb-4 text-sm text-red-700 dark:text-red-300" role="alert">
          Your email setting could not be loaded. Reload the page to try again.
        </p>
      ) : null}
    </Group>
  )
}

/**
 * Publishing activity per social set (RFC 043). A switch turned off here
 * silences that kind for the one set; the per-activity table above still
 * decides the channel. Saved with the rest of your preferences.
 */
export function SocialSetNotifications({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean
  onChange: (next: SocialSetNotificationPreferences) => void
  value: SocialSetNotificationPreferences
}) {
  const sets = useSocialSets()
  // Social sets are off on this server: there is nothing to choose.
  if (sets.error instanceof SettingsRequestError && sets.error.status === 404) return null
  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">By social set</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Turn publishing activity off for one social set. A private set&apos;s activity reaches
          only its owner.
        </p>
      </div>
      {sets.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading social sets…
        </p>
      ) : sets.isError ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {settingsErrorMessage(sets.error)}
        </p>
      ) : sets.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No social sets yet.</p>
      ) : (
        <Group>
          {sets.data.items.map((set) => (
            <fieldset
              className="border-b border-border px-5 py-4 last:border-0"
              disabled={disabled}
              key={set.id}
            >
              <legend className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: set.color }}
                />
                {set.name}
              </legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SET_KINDS.map((kind) => (
                  <label className="flex items-center gap-2 text-sm" key={kind.id}>
                    <Checkbox
                      checked={value[set.id]?.[kind.id] ?? true}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...value,
                          [set.id]: { ...value[set.id], [kind.id]: checked === true },
                        })
                      }
                    />
                    {kind.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </Group>
      )}
    </div>
  )
}
