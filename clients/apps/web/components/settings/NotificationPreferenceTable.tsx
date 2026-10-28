'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  const required = (id: string) =>
    settings.catalogue.find((event) => event.id === id)?.mandatoryFailure === true
  const optionalEvents = events.filter((event) => !required(event.id))
  return (
    <div
      className="overflow-x-auto [&>[data-slot=table-container]]:overflow-visible"
      role="region"
      aria-label={`${context ?? group} notification channels`}
      tabIndex={0}
    >
      <p className="mb-3 text-xs text-muted-foreground sm:hidden">
        Scroll horizontally to see all delivery channels.
      </p>
      <Table className="w-full min-w-[36rem] text-left text-sm">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pb-3 font-medium">
              Activity
            </TableHead>
            {preferenceChannels.map((channel) => (
              <TableHead scope="col" className="px-3 pb-3 font-medium" key={channel.id}>
                {channel.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="border-t border-border bg-muted/30">
            <TableHead scope="row" className="py-3 pr-4 font-medium whitespace-normal">
              All {group}
            </TableHead>
            {preferenceChannels.map((channel) => {
              const checked = preferenceGroupState(
                optionalEvents.map((event) =>
                  preferenceSelected(value, event.id, channel.id, setId)
                )
              )
              return (
                <TableCell className="px-3 py-3" key={channel.id}>
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`${context ? `${context}: ` : ''}All ${group}: your ${channel.label.toLowerCase()} preferences`}
                      checked={checked}
                      onCheckedChange={() =>
                        onChange(
                          changePreferences(
                            value,
                            optionalEvents.map((event) => event.id),
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
                  </Label>
                </TableCell>
              )
            })}
          </TableRow>
          {events.map((event) => (
            <TableRow className="border-t border-border" key={event.id}>
              <TableHead scope="row" className="py-3 pr-4 font-normal whitespace-normal">
                {event.label}
              </TableHead>
              {preferenceChannels.map((channel) => {
                const checked = preferenceSelected(value, event.id, channel.id, setId)
                return (
                  <TableCell className="px-3 py-3 align-top whitespace-normal" key={channel.id}>
                    {required(event.id) ? (
                      <span className="text-xs font-medium">Required alert</span>
                    ) : (
                      <Label className="flex items-center gap-2">
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
                      </Label>
                    )}
                    <p className="mt-1 max-w-44 text-xs text-muted-foreground">
                      Delivery when saved:{' '}
                      {preferenceDeliveryReason(
                        settings,
                        emailEnabled,
                        event.id,
                        channel.id,
                        checked,
                        value.slackEnabled !== false
                      )}
                    </p>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
