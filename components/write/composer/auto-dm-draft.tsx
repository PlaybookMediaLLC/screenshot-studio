'use client'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { autoDmSchema, type AutoDm } from '@/lib/write/document'

/** Prepare and persist a campaign while making the unavailable delivery state explicit. */
export function AutoDmDraft({
  value,
  onChange,
  readOnly,
}: {
  value?: AutoDm
  onChange: (value: AutoDm | undefined) => void
  readOnly: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<AutoDm>(
    value ?? { match: 'any', replies: true, reposts: false, requireFollow: false, message: '' }
  )
  const [error, setError] = React.useState('')
  return (
    <>
      <Button
        disabled={readOnly}
        variant="outline"
        size="sm"
        className="h-7 rounded-full text-xs"
        onClick={() => {
          setForm(
            value ?? {
              match: 'any',
              replies: true,
              reposts: false,
              requireFollow: false,
              message: '',
            }
          )
          setOpen(true)
        }}
      >
        Auto-DM settings{value ? ' · prepared' : ''}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prepare Auto-DM campaign</DialogTitle>
            <DialogDescription>
              Delivery is off. Authorized X messaging and event access, consent records, and opt-out
              processing must be configured before campaigns can run.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const parsed = autoDmSchema.safeParse(form)
              if (!parsed.success) {
                setError(parsed.error.issues[0].message)
                return
              }
              onChange(parsed.data)
              setOpen(false)
            }}
          >
            <p className="text-xs">
              The first post must explicitly offer a DM. Eligible recipients must opt in to that
              offer. Campaigns last four days; product caps are 30/minute, 100/hour, 500/day, and
              three active campaigns, subject to lower provider limits.
            </p>
            <label>
              Match
              <select
                aria-label="Auto-DM action matching"
                value={form.match}
                onChange={(event) =>
                  setForm({ ...form, match: event.target.value as AutoDm['match'] })
                }
                className="ml-2 border p-1"
              >
                <option value="any">Any selected action</option>
                <option value="all">All selected actions</option>
              </select>
            </label>
            {(['replies', 'reposts', 'requireFollow'] as const).map((key) => (
              <label key={key} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      [key]: event.target.checked,
                      ...(key === 'replies' && !event.target.checked ? { replyText: '' } : {}),
                    })
                  }
                />
                {
                  {
                    replies: 'Replied to the first post',
                    reposts: 'Reposted the first post',
                    requireFollow: 'Must also follow this account',
                  }[key]
                }
              </label>
            ))}
            <label>
              Reply must contain
              <Input
                disabled={!form.replies}
                maxLength={100}
                value={form.replyText ?? ''}
                onChange={(event) => setForm({ ...form, replyText: event.target.value })}
              />
            </label>
            <label>
              Direct message
              <Textarea
                maxLength={10_000}
                value={form.message}
                onChange={(event) => setForm({ ...form, message: event.target.value })}
              />
            </label>
            <p className="text-xs">
              Variables: {'{{first_name}}, {{full_name}}, {{username}}, {{action}}, {{post_url}}'}.
              An opt-out instruction is appended. Following or engaging alone is not consent.
            </p>
            {error ? <p role="alert">{error}</p> : null}
            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                Remove settings
              </Button>
              <Button type="submit">Save prepared settings</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
