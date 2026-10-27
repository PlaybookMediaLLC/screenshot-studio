'use client'

import * as React from 'react'
import { searchEmoji } from '@shots/platejs-editor/lib'
import { Input } from '@/components/ui/input'

/** Searchable, keyboard-operated emoji choices shared with Plate's alias plugin. */
export function ComposerEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const id = React.useId()
  const choices = React.useMemo(() => searchEmoji(query), [query])
  return (
    <div className="grid gap-2">
      <Input
        aria-label="Search emoji"
        aria-controls={id}
        aria-activedescendant={choices[active] ? `${id}-${active}` : undefined}
        aria-expanded
        role="combobox"
        placeholder="Search emoji or :alias"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[event.key]
          if (step !== undefined) {
            event.preventDefault()
            setActive((current) => Math.max(0, Math.min(choices.length - 1, current + step)))
          } else if (event.key === 'Enter' && choices[active]) {
            event.preventDefault()
            onSelect(choices[active].native)
          }
        }}
      />
      <div
        id={id}
        role="listbox"
        aria-label="Emoji"
        className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto"
      >
        {choices.map((emoji, index) => (
          <button
            id={`${id}-${index}`}
            key={emoji.id}
            role="option"
            aria-selected={active === index}
            aria-label={`${emoji.name} :${emoji.id}:`}
            title={emoji.name}
            type="button"
            tabIndex={-1}
            className="rounded p-1 text-lg aria-selected:bg-accent"
            ref={(node) => {
              if (index === active) node?.scrollIntoView({ block: 'nearest' })
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(emoji.native)}
          >
            {emoji.native}
          </button>
        ))}
      </div>
      {!choices.length ? (
        <p role="status" className="text-xs">
          No emoji found.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Arrow keys to choose, Enter to insert, Escape to close. You can also type :alias in your
        draft.
      </p>
    </div>
  )
}
