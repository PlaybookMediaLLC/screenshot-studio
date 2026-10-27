'use client'

import { CalendarIcon as CalendarIcon } from '@phosphor-icons/react/dist/ssr/Calendar'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** A YYYY-MM-DD day as a local Date at noon, so no zone moves it a day. */
function dayDate(day: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}

/** A local Date as YYYY-MM-DD. */
function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * A day picked from a {@link Calendar} in a popover. The value is a calendar
 * day, YYYY-MM-DD, as a native date input's would be; `min` and `max` bound
 * it the same way.
 */
function DatePicker({
  className,
  disabled,
  id,
  max,
  min,
  onChange,
  placeholder = 'Pick a day',
  value,
  ...props
}: {
  className?: string
  disabled?: boolean
  id?: string
  max?: string
  min?: string
  onChange: (day: string) => void
  placeholder?: string
  value: string
} & Pick<React.ComponentProps<'button'>, 'aria-label' | 'aria-describedby'>) {
  const [open, setOpen] = React.useState(false)
  const selected = dayDate(value)
  const from = min ? dayDate(min) : undefined
  const to = max ? dayDate(max) : undefined
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            'h-9 justify-start gap-2 font-normal',
            !selected && 'text-muted-foreground',
            className
          )}
          disabled={disabled}
          id={id}
          type="button"
          variant="outline"
          {...props}
        >
          <CalendarIcon aria-hidden className="size-4" />
          {selected
            ? selected.toLocaleDateString(undefined, { dateStyle: 'medium' })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          autoFocus
          defaultMonth={selected ?? from}
          disabled={[...(from ? [{ before: from }] : []), ...(to ? [{ after: to }] : [])]}
          mode="single"
          onSelect={(date) => {
            if (!date) return
            onChange(dayKey(date))
            setOpen(false)
          }}
          selected={selected}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
