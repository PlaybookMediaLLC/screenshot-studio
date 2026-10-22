'use client'

import { Checkbox } from '@/components/ui/checkbox'
import {
  changePreferences,
  preferenceChannels,
  preferenceDeliveryReason,
  preferenceGroupState,
  preferenceSelected,
} from '@/lib/notifications/preferences'
import type { NotificationSettings } from '@/lib/notifications/schema'

/** Accessible category controls share the same channel semantics as individual rows. */
export function NotificationPreferenceTable({
  events,
  group,
  value,
  onChange,
  settings,
  emailEnabled,
  setId,
  context,
}: {
  events: readonly { id: string; label: string }[]
  group: string
  value: NotificationSettings['preferences']
  onChange: (next: NotificationSettings['preferences']) => void
  settings: NotificationSettings
  emailEnabled: boolean
  setId?: string
  context?: string
}) {
  return (
    <div
      className="overflow-x-auto"
      role="region"
      aria-label={`${context ?? group} notification channels`}
      tabIndex={0}
    >
      <p className="mb-3 text-xs text-muted-foreground sm:hidden">
        Scroll horizontally to see all delivery channels.
      </p>
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="pb-3 font-medium">
              Activity
            </th>
            {preferenceChannels.map((channel) => (
              <th scope="col" className="px-3 pb-3 font-medium" key={channel.id}>
                {channel.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border bg-muted/30">
            <th scope="row" className="py-3 pr-4 font-medium">
              All {group}
            </th>
            {preferenceChannels.map((channel) => {
              const checked = preferenceGroupState(
                events.map((event) => preferenceSelected(value, event.id, channel.id, setId))
              )
              return (
                <td className="px-3 py-3" key={channel.id}>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`${context ? `${context}: ` : ''}All ${group}: your ${channel.label.toLowerCase()} preferences`}
                      checked={checked}
                      onCheckedChange={() =>
                        onChange(
                          changePreferences(
                            value,
                            events.map((event) => event.id),
                            channel.id,
                            checked !== true,
                            setId
                          )
                        )
                      }
                    />
                    <span className="text-xs">
                      {checked === 'indeterminate' ? 'Some' : checked ? 'All' : 'None'}
                    </span>
                  </label>
                </td>
              )
            })}
          </tr>
          {events.map((event) => (
            <tr className="border-t border-border" key={event.id}>
              <th scope="row" className="py-3 pr-4 font-normal">
                {event.label}
              </th>
              {preferenceChannels.map((channel) => {
                const checked = preferenceSelected(value, event.id, channel.id, setId)
                return (
                  <td className="px-3 py-3 align-top" key={channel.id}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        aria-label={`${context ? `${context}: ` : ''}${event.label}: your ${channel.id === 'slack' ? 'Slack DM' : channel.label.toLowerCase()} preference`}
                        checked={checked}
                        onCheckedChange={(next) =>
                          onChange(
                            changePreferences(value, [event.id], channel.id, next === true, setId)
                          )
                        }
                      />
                      <span className="text-xs">Your preference: {checked ? 'On' : 'Off'}</span>
                    </label>
                    <p className="mt-1 max-w-44 text-xs text-muted-foreground">
                      Delivery when saved:{' '}
                      {preferenceDeliveryReason(
                        settings,
                        emailEnabled,
                        event.id,
                        channel.id,
                        checked
                      )}
                    </p>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
