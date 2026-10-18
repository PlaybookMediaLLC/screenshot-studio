'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'

/** One X post's follow-ups and poll, as the schedule request carries them. */
export type XPostOptions = {
  autoActions?: {
    plugAtLikes?: number
    plugText?: string
    quoteAfterHours?: number
    quoteText?: string
    repostAtLikes?: number
  }
  poll?: { durationMinutes: number; options: string[] }
}

/** Positive whole numbers only; anything else is off. */
function count(text: string): number | undefined {
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * X's extras for one post: a repost and a reply once it has enough likes, a
 * quote some hours later, and a poll. Collapsed until opened; an empty field
 * is off.
 */
export function XOptions({
  hasImages,
  onChange,
  value,
}: {
  /** X polls cannot carry images. */
  hasImages: boolean
  onChange: (value: XPostOptions) => void
  value: XPostOptions
}) {
  const actions = value.autoActions ?? {}
  const poll = value.poll
  const set = (next: Partial<NonNullable<XPostOptions['autoActions']>>) =>
    onChange({ ...value, autoActions: { ...actions, ...next } })
  const options = poll?.options ?? ['', '']
  const setPoll = (next: Partial<NonNullable<XPostOptions['poll']>> | null) =>
    onChange({
      ...value,
      poll: next === null ? undefined : { durationMinutes: 1440, options, ...poll, ...next },
    })
  const field = 'h-8 text-xs'
  return (
    <details className="mt-1 rounded-lg border border-white/[0.06] px-3 py-2 text-xs text-neutral-400">
      <summary className="cursor-pointer select-none text-neutral-300">
        X extras: follow-ups and a poll
      </summary>
      <div className="mt-2 grid gap-2">
        <label className="flex items-center gap-2">
          Repost it at
          <Input
            aria-label="Repost at likes"
            className={`${field} w-20`}
            inputMode="numeric"
            onChange={(event) => set({ repostAtLikes: count(event.target.value) })}
            value={actions.repostAtLikes ?? ''}
          />
          likes
        </label>
        <label className="flex items-center gap-2">
          Reply at
          <Input
            aria-label="Auto reply at likes"
            className={`${field} w-20`}
            inputMode="numeric"
            onChange={(event) => set({ plugAtLikes: count(event.target.value) })}
            value={actions.plugAtLikes ?? ''}
          />
          likes with
        </label>
        <Input
          aria-label="Auto reply text"
          className={field}
          onChange={(event) => set({ plugText: event.target.value })}
          placeholder="Thanks for the love — here's the link: …"
          value={actions.plugText ?? ''}
        />
        <label className="flex items-center gap-2">
          Quote it again after
          <Input
            aria-label="Quote after hours"
            className={`${field} w-20`}
            inputMode="numeric"
            onChange={(event) => set({ quoteAfterHours: count(event.target.value) })}
            value={actions.quoteAfterHours ?? ''}
          />
          hours with
        </label>
        <Input
          aria-label="Quote text"
          className={field}
          onChange={(event) => set({ quoteText: event.target.value })}
          placeholder="In case you missed it:"
          value={actions.quoteText ?? ''}
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-neutral-300">Poll</span>
          {poll ? (
            <button className="hover:text-white" onClick={() => setPoll(null)} type="button">
              Remove poll
            </button>
          ) : (
            <button
              className="hover:text-white disabled:opacity-40"
              disabled={hasImages}
              onClick={() => setPoll({})}
              title={hasImages ? 'An X poll cannot have images.' : undefined}
              type="button"
            >
              Add a poll
            </button>
          )}
        </div>
        {poll ? (
          <div className="grid gap-1.5">
            {options.map((option, index) => (
              <Input
                aria-label={`Poll choice ${index + 1}`}
                className={field}
                // biome-ignore lint/suspicious/noArrayIndexKey: choices are positional
                key={index}
                maxLength={25}
                onChange={(event) =>
                  setPoll({
                    options: options.map((item, at) => (at === index ? event.target.value : item)),
                  })
                }
                value={option}
              />
            ))}
            {options.length < 4 ? (
              <button
                className="justify-self-start hover:text-white"
                onClick={() => setPoll({ options: [...options, ''] })}
                type="button"
              >
                + Choice
              </button>
            ) : null}
            <label className="flex items-center gap-2">
              Open for
              <select
                aria-label="Poll length"
                className="h-8 rounded-md border border-white/[0.08] bg-transparent px-2"
                onChange={(event) => setPoll({ durationMinutes: Number(event.target.value) })}
                value={poll.durationMinutes}
              >
                {[60, 360, 1440, 4320, 10080].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes < 1440 ? `${minutes / 60} hours` : `${minutes / 1440} days`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </details>
  )
}

/** The options as the API takes them: empty actions and blank choices dropped. */
export function xOptionsForRequest(value: XPostOptions): XPostOptions | undefined {
  const actions = Object.fromEntries(
    Object.entries(value.autoActions ?? {}).filter(([, item]) => item !== undefined && item !== '')
  ) as XPostOptions['autoActions']
  const poll = value.poll
    ? { ...value.poll, options: value.poll.options.map((option) => option.trim()).filter(Boolean) }
    : undefined
  const result: XPostOptions = {}
  if (actions && Object.keys(actions).length > 0) result.autoActions = actions
  if (poll && poll.options.length >= 2) result.poll = poll
  return Object.keys(result).length > 0 ? result : undefined
}
