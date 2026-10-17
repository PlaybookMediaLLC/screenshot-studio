'use client'

import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fontFamilies, getFontCSS } from '@/lib/constants/fonts'
import { GOOGLE_FONTS, googleFontFamily, googleFontId, isGoogleFontId } from '@/lib/typography/google-fonts'
import { cn } from '@/lib/utils'

type Option = { group: string; id: string; name: string }

const OPTIONS: Option[] = [
  ...fontFamilies.map((font) => ({ group: 'Editor fonts', id: font.id, name: font.name })),
  ...GOOGLE_FONTS.map((font) => ({
    group: `Google Fonts · ${font.category}`,
    id: `google:${font.family}`,
    name: font.family,
  })),
]

function fontName(id: string): string {
  if (isGoogleFontId(id)) return googleFontFamily(id)
  return fontFamilies.find((font) => font.id === id)?.name ?? id
}

/**
 * Pick a font: the editor's fonts, popular Google Fonts, or any Google Fonts
 * family typed by name. Keyboard: type to filter, arrows to move, Enter to pick.
 */
export function FontPicker({ onChange, value }: { onChange: (id: string) => void; value: string }) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const search = query.trim().toLowerCase()
  const matches = OPTIONS.filter((option) => !search || option.name.toLowerCase().includes(search))
  const custom = search && !matches.some((option) => option.name.toLowerCase() === search) ? googleFontId(query) : null
  const choices: Option[] = custom ? [...matches, { group: 'Google Fonts', id: custom, name: `Use “${googleFontFamily(custom)}”` }] : matches

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Font family"
          className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-2.5 text-left text-xs"
          style={{ fontFamily: getFontCSS(value) }}
          type="button"
        >
          <span className="truncate">{fontName(value)}</span>
          <span className="text-muted-foreground">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <input
          aria-activedescendant={choices[active] ? `font-option-${active}` : undefined}
          aria-controls="font-options"
          aria-label="Search fonts"
          autoFocus
          className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') setActive((index) => Math.min(choices.length - 1, index + 1))
            else if (event.key === 'ArrowUp') setActive((index) => Math.max(0, index - 1))
            else if (event.key === 'Enter' && choices[active]) pick(choices[active].id)
            else return
            event.preventDefault()
          }}
          placeholder="Search or type a Google Fonts family"
          role="combobox"
          aria-expanded
          value={query}
        />
        <ul className="max-h-64 overflow-y-auto" id="font-options" role="listbox">
          {choices.map((option, index) => (
            <li key={option.id}>
              {index === 0 || choices[index - 1]!.group !== option.group ? (
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {option.group}
                </p>
              ) : null}
              <button
                aria-selected={option.id === value}
                className={cn(
                  'w-full truncate rounded px-2 py-1.5 text-left text-xs',
                  index === active ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.05]',
                  option.id === value && 'font-semibold'
                )}
                id={`font-option-${index}`}
                onClick={() => pick(option.id)}
                onMouseEnter={() => setActive(index)}
                role="option"
                type="button"
              >
                {option.name}
              </button>
            </li>
          ))}
          {choices.length === 0 ? <li className="px-2 py-3 text-xs text-muted-foreground">No fonts match.</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
