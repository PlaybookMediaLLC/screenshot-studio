import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

/** A platform and public handle entered together. */
export type HandleRow = { platform: string; handle: string }
const platforms = [
  'x',
  'linkedin',
  'instagram',
  'threads',
  'bluesky',
  'mastodon',
  'facebook',
  'youtube',
  'tiktok',
]

/** Keeps structured handles editable without asking users to write a mini-language. */
export function HandleRows({
  value,
  onChange,
}: {
  value: HandleRow[]
  onChange: (value: HandleRow[]) => void
}) {
  return (
    <div className="grid gap-3">
      {value.map((row, index) => (
        <div className="flex flex-wrap gap-2" key={index}>
          <Select
            value={row.platform}
            onValueChange={(platform) =>
              onChange(value.map((item, at) => (at === index ? { ...item, platform } : item)))
            }
          >
            <SelectTrigger aria-label={`Social handle ${index + 1} platform`} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([row.platform, ...platforms])].map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {platform}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="min-w-40 flex-1"
            aria-label={`Social handle ${index + 1}`}
            value={row.handle}
            maxLength={160}
            placeholder="@yourbrand"
            onChange={(event) =>
              onChange(
                value.map((item, at) =>
                  at === index ? { ...item, handle: event.target.value } : item
                )
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            aria-label={`Remove social handle ${index + 1}`}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        className="justify-self-start"
        type="button"
        variant="outline"
        onClick={() =>
          onChange([
            ...value,
            {
              platform:
                platforms.find((platform) => !value.some((row) => row.platform === platform)) ??
                'x',
              handle: '',
            },
          ])
        }
      >
        Add social handle
      </Button>
    </div>
  )
}

const styles = [
  'Short sentences',
  'Second person',
  'Plain language',
  'Conversational',
  'Technical',
  'No emojis',
]
/** Selectable writing styles, preserving custom values from existing profiles. */
export function StyleChips({
  value,
  onChange,
}: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  const [custom, setCustom] = useState('')
  return (
    <div className="flex flex-wrap gap-2">
      {[...new Set([...styles, ...value])].map((style) => (
        <Button
          key={style}
          type="button"
          size="sm"
          aria-pressed={value.includes(style)}
          disabled={!value.includes(style) && value.length >= 50}
          variant={value.includes(style) ? 'default' : 'outline'}
          onClick={() =>
            onChange(
              value.includes(style) ? value.filter((item) => item !== style) : [...value, style]
            )
          }
        >
          {style}
        </Button>
      ))}
      <div className="flex w-full gap-2">
        <Input
          aria-label="Custom preferred style"
          maxLength={100}
          placeholder="Add a writing style"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!custom.trim() || value.includes(custom.trim()) || value.length >= 50}
          onClick={() => {
            onChange([...value, custom.trim()])
            setCustom('')
          }}
        >
          Add style
        </Button>
      </div>
    </div>
  )
}
