import { useId } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const LOCALES = [
  'en',
  'en-US',
  'en-GB',
  'fr',
  'fr-CA',
  'de',
  'es',
  'es-MX',
  'pt-BR',
  'pt-PT',
  'it',
  'nl',
  'sv',
  'da',
  'nb',
  'fi',
  'pl',
  'tr',
  'ar',
  'he',
  'hi',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
]
const names = new Intl.DisplayNames(['en'], { type: 'language' })
/** Language and region choices, retaining any locale already saved by the workspace. */
export function LocalePicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <Label className="sr-only" htmlFor={id}>
        Locale
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([value, ...LOCALES])].filter(Boolean).map((locale) => (
            <SelectItem key={locale} value={locale}>
              {names.of(locale) ?? locale} ({locale})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
