'use client'

import * as React from 'react'
import { PiPlus as Add01Icon, PiTrash as Delete02Icon } from 'react-icons/pi'
import { ChoiceField, ToggleField } from '@/components/editor/inspector/fields'
import { resolveAppearance } from '@/lib/frames/appearance'
import { APPEARANCE_LABELS, BROWSER_LABELS, WINDOW_LABELS } from '@/lib/frames/labels'
import {
  type Appearance,
  appearanceSchema,
  browserSchema,
  type FrameChrome,
  MAX_FRAME_BOOKMARKS,
  MAX_FRAME_TABS,
  windowStyleSchema,
} from '@/lib/frames/schema'
import { cn } from '@/lib/utils'
import { withTypingHistory } from '@/lib/store'
import { ChromeFrame } from '../ChromeFrame'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * Options for browser and window frames: which browser or window, light or
 * dark (or automatic), and what the chrome says. The same controls edit the
 * main screenshot and composition screens.
 */

const fieldClass =
  'h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.04] px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15'

/** A labelled single-line text field. */
export function TextField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  const id = React.useId()
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <Input
        className={fieldClass}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  )
}

function Preview({
  chrome,
  kind,
  selected,
  label,
  onSelect,
}: {
  chrome: FrameChrome
  kind: 'browser' | 'window'
  label: string
  onSelect: () => void
  selected: boolean
}) {
  const tone = resolveAppearance(chrome.appearance, chrome.tone)
  return (
    <Button variant="custom" size={null}
      aria-label={label}
      aria-pressed={selected}
      className="group flex min-w-0 flex-col items-center gap-1.5"
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          'flex h-[72px] w-full items-center justify-center rounded-[10px] border p-1.5 transition-colors',
          selected
            ? 'border-foreground/25 bg-foreground/[0.1]'
            : 'border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.06]'
        )}
      >
        {/* The chrome drawn larger than life, so each style reads at thumbnail size. */}
        <ChromeFrame
          frame={{ chrome: { ...chrome, showBookmarks: false, tabs: [] }, kind }}
          height={58}
          scale={2.4}
          tone={tone}
          width={96}
        >
          <span
            className="block h-full w-full"
            style={{ background: tone === 'dark' ? '#18181b' : '#ffffff' }}
          />
        </ChromeFrame>
      </span>
      <span
        className={cn(
          'w-full truncate text-center text-[10px] leading-tight',
          selected ? 'font-medium text-foreground' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
    </Button>
  )
}

function AppearanceField({
  chrome,
  onChange,
}: {
  chrome: FrameChrome
  onChange: (changes: Partial<FrameChrome>) => void
}) {
  return (
    <div className="space-y-1">
      <ChoiceField<Appearance>
        label="Appearance"
        onChange={(appearance) => onChange({ appearance })}
        options={appearanceSchema.options.map((value) => ({
          label: APPEARANCE_LABELS[value],
          value,
        }))}
        value={chrome.appearance}
      />
      {chrome.appearance === 'auto' ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Follows the screenshot:{' '}
          {resolveAppearance('auto', chrome.tone) === 'dark' ? 'dark' : 'light'} chrome for this
          one.
        </p>
      ) : null}
    </div>
  )
}

function TabsField({
  chrome,
  onChange,
}: {
  chrome: FrameChrome
  onChange: (changes: Partial<FrameChrome>) => void
}) {
  const group = React.useId()
  const tabs = chrome.tabs.length > 0 ? chrome.tabs : ['']
  const write = (next: string[], activeTab = chrome.activeTab) =>
    onChange({
      activeTab: Math.min(activeTab, Math.max(0, next.length - 1)),
      tabs: next.length === 1 && !next[0] ? [] : next,
    })
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs text-muted-foreground">Tabs</legend>
      {tabs.map((title, index) => (
        <div className="flex items-center gap-1.5" key={index}>
          <Input
            aria-label={`Tab ${index + 1} is the active tab`}
            checked={Math.min(chrome.activeTab, tabs.length - 1) === index}
            className="size-3.5 accent-foreground"
            name={group}
            onChange={() => onChange({ activeTab: index })}
            type="radio"
          />
          <Input
            aria-label={`Tab ${index + 1} title`}
            className={fieldClass}
            maxLength={60}
            aria-describedby={`${group}-${index}-count`}
            onChange={(event) =>
              withTypingHistory(`${group}:${index}`, () =>
                write(tabs.map((tab, at) => (at === index ? event.target.value : tab))))
            }
            placeholder={index === 0 ? 'Page title' : `Tab ${index + 1}`}
            value={title}
          />
          <span id={`${group}-${index}-count`} className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{title.length}/60</span>
          {tabs.length > 1 ? (
            <Button variant="custom" size={null}
              aria-label={`Remove tab ${index + 1}`}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() =>
                write(
                  tabs.filter((_, at) => at !== index),
                  chrome.activeTab > index ? chrome.activeTab - 1 : chrome.activeTab
                )
              }
              type="button"
            >
              <Delete02Icon size={13} />
            </Button>
          ) : null}
        </div>
      ))}
      {tabs.length < MAX_FRAME_TABS ? (
        <Button variant="custom" size={null}
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          onClick={() =>
            write([
              ...tabs.map((tab, index) => tab || (index === 0 ? 'Home' : tab)),
              `Tab ${tabs.length + 1}`,
            ])
          }
          type="button"
        >
          <Add01Icon size={12} /> Add tab
        </Button>
      ) : <p className="text-xs text-muted-foreground">Maximum {MAX_FRAME_TABS} tabs. Remove a tab to add another.</p>}
    </fieldset>
  )
}

const parseBookmarks = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, MAX_FRAME_BOOKMARKS)

function BookmarksField({
  chrome,
  onChange,
}: {
  chrome: FrameChrome
  onChange: (changes: Partial<FrameChrome>) => void
}) {
  const [draft, setDraft] = React.useState(chrome.bookmarks.join(', '))
  const current = chrome.bookmarks.join(',')
  // Follow changes made elsewhere (undo, another screen), not the user's own typing.
  if (parseBookmarks(draft).join(',') !== current) setDraft(chrome.bookmarks.join(', '))
  return (
    <div className="space-y-2">
      <ToggleField
        checked={chrome.showBookmarks}
        label="Bookmarks bar"
        onChange={(showBookmarks) => onChange({ showBookmarks })}
      />
      {chrome.showBookmarks ? (
        <TextField
          label="Bookmarks, separated by commas"
          onChange={(value) => {
            setDraft(value)
            onChange({ bookmarks: parseBookmarks(value) })
          }}
          placeholder="Docs, Pricing, Changelog"
          value={draft}
        />
      ) : null}
    </div>
  )
}

/** Browser choice and its address, tabs, bookmarks, and appearance. */
export function BrowserOptions({
  chrome,
  onChange,
}: {
  chrome: FrameChrome
  onChange: (changes: Partial<FrameChrome>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Browser">
        {browserSchema.options.map((browser) => (
          <Preview
            chrome={{ ...chrome, browser }}
            key={browser}
            kind="browser"
            label={BROWSER_LABELS[browser]}
            onSelect={() => onChange({ browser })}
            selected={chrome.browser === browser}
          />
        ))}
      </div>
      <AppearanceField chrome={chrome} onChange={onChange} />
      <TextField
        label="Address"
        onChange={(address) => onChange({ address })}
        placeholder="yourapp.com"
        value={chrome.address}
      />
      <TabsField chrome={chrome} onChange={onChange} />
      <BookmarksField chrome={chrome} onChange={onChange} />
    </div>
  )
}

/** Window style choice, its title, and appearance. */
export function WindowOptions({
  chrome,
  onChange,
}: {
  chrome: FrameChrome
  onChange: (changes: Partial<FrameChrome>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Window style">
        {windowStyleSchema.options.map((window) => (
          <Preview
            chrome={{ ...chrome, window }}
            key={window}
            kind="window"
            label={WINDOW_LABELS[window]}
            onSelect={() => onChange({ window })}
            selected={chrome.window === window}
          />
        ))}
      </div>
      <AppearanceField chrome={chrome} onChange={onChange} />
      <TextField
        label="Title"
        onChange={(title) => onChange({ title })}
        placeholder={chrome.window.startsWith('terminal') ? 'zsh' : 'App name'}
        value={chrome.title}
      />
    </div>
  )
}
