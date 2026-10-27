'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createAssetMeta } from '@/lib/store-screenshots/document/factory'
import { fontSourceSchema, type FontSource, type StoreAsset } from '@/lib/store-screenshots/document/schema'
import {
  BUNDLED_FONTS,
  detectFontFormat,
  fontMime,
  fontStackFor,
  googleFontStylesheetUrl,
  MAX_FONT_BYTES,
  SUGGESTED_GOOGLE_FONTS,
} from '@/lib/store-screenshots/fonts'
import { sha256Hex } from '@/lib/store-screenshots/media/image'
import { putAsset } from '@/lib/store-screenshots/persistence/projects'
import { useEditor, useEditorApi } from '../editor-store'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

/**
 * Font family picker: bundled fonts, fonts added to this project from
 * Google Fonts, and uploaded font files (validated by signature, with a
 * licensing confirmation).
 */

function useAddFont() {
  const api = useEditorApi()
  return React.useCallback(
    (source: FontSource, asset?: StoreAsset) => {
      const document = api.getState().document
      if (document.fonts.some((font) => font.family === source.family)) return
      const commands = [
        ...(asset ? [{ type: 'assets.add' as const, assets: [asset] }] : []),
        { type: 'project.patch' as const, patch: { fonts: [...document.fonts, source] } },
      ]
      api.getState().dispatchMany(commands, 'Add font')
    },
    [api]
  )
}

/** The picker. `value` is a CSS font stack. */
export function FontPicker({ label, value, onChange }: { label: string; value: string; onChange: (stack: string) => void }): React.JSX.Element {
  const fonts = useEditor((state) => state.document.fonts)
  const addFont = useAddFont()
  const id = React.useId()
  const [open, setOpen] = React.useState(false)
  const [family, setFamily] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [licensed, setLicensed] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const known = BUNDLED_FONTS.some((font) => font.value === value) || fonts.some((font) => fontStackFor(font) === value)

  const addGoogle = async (name: string) => {
    const parsed = fontSourceSchema.shape.family.safeParse(name.trim())
    if (!parsed.success) {
      toast.error('Enter a font family name, for example “Noto Sans JP”.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch(googleFontStylesheetUrl(parsed.data))
      if (!response.ok) throw new Error('missing')
      addFont({ family: parsed.data, kind: 'google', assetId: null })
      onChange(fontStackFor({ family: parsed.data, kind: 'google', assetId: null }))
      setFamily('')
      setOpen(false)
    } catch {
      toast.error(`“${parsed.data}” was not found on Google Fonts.`)
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File) => {
    if (file.size > MAX_FONT_BYTES) {
      toast.error('Font files can be at most 5 MB.')
      return
    }
    const bytes = await file.arrayBuffer()
    const format = detectFontFormat(new Uint8Array(bytes.slice(0, 4)))
    if (!format) {
      toast.error(`“${file.name}” is not a WOFF2, WOFF, TTF, or OTF font.`)
      return
    }
    const familyName = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Custom font'
    const blob = new Blob([bytes], { type: fontMime(format) })
    try {
      await new FontFace(familyName, bytes).load()
    } catch {
      toast.error(`“${file.name}” could not be loaded as a font.`)
      return
    }
    const assetId = `font_${(await sha256Hex(bytes)).slice(0, 32)}`
    await putAsset(assetId, blob)
    const asset = createAssetMeta({ id: assetId, name: file.name, mime: blob.type, width: 1, height: 1, bytes: blob.size })
    addFont({ family: familyName, kind: 'custom', assetId }, asset)
    onChange(fontStackFor({ family: familyName, kind: 'custom', assetId }))
    setOpen(false)
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="block text-[11px] text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-1.5">
        <Select value={value} onValueChange={(nextValue) => onChange(nextValue)}>
          <SelectTrigger
            id={id}
            className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none focus:border-foreground/30"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!known ? <SelectItem value={value}>Current font</SelectItem> : null}
            <SelectGroup>
              <SelectLabel>{'Included'}</SelectLabel>
              {BUNDLED_FONTS.map((font) => (
                <SelectItem key={font.value} value={font.value}>
                  {font.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {fonts.length ? (
              <SelectGroup>
                <SelectLabel>{'This project'}</SelectLabel>
                {fonts.map((font) => (
                  <SelectItem key={font.family} value={fontStackFor(font)}>
                    {font.family}
                    {font.kind === 'custom' ? ' (uploaded)' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="custom" size={null} type="button" className="h-8 shrink-0 rounded-md border border-foreground/10 px-2 text-[11px] hover:bg-foreground/[0.05]" aria-label="Add a font">
              Add
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3 p-3">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                void addGoogle(family)
              }}
            >
              <Label className="block text-[11px] font-medium" htmlFor={`${id}-google`}>
                Google Fonts family
              </Label>
              <div className="flex gap-1.5">
                <Input
                  id={`${id}-google`}
                  value={family}
                  onChange={(event) => setFamily(event.target.value)}
                  placeholder="e.g. Noto Sans JP"
                  list={`${id}-suggestions`}
                  className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none"
                />
                <datalist id={`${id}-suggestions`}>
                  {SUGGESTED_GOOGLE_FONTS.map((name) => (
                    <SelectItem key={name} value={name} />
                  ))}
                </datalist>
                <Button variant="custom" size={null} type="submit" disabled={busy || !family.trim()} className="h-8 rounded-md bg-foreground px-2.5 text-[11px] text-background disabled:opacity-40">
                  Add
                </Button>
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">Noto fonts cover Japanese, Korean, Chinese, Arabic, Hebrew, and other scripts.</p>
            </form>
            <div className="space-y-2 border-t border-foreground/10 pt-3">
              <Label className="flex items-start gap-2 text-[11px] leading-snug">
                <Checkbox  checked={licensed} onCheckedChange={(checked) => setLicensed((checked === true))} className="mt-0.5" />
                I have a license to use this font in published app store artwork.
              </Label>
              <Button variant="custom" size={null}
                type="button"
                disabled={!licensed}
                onClick={() => fileRef.current?.click()}
                className="h-8 w-full rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05] disabled:opacity-40"
              >
                Upload WOFF2, WOFF, TTF, or OTF
              </Button>
              <Input
                ref={fileRef}
                type="file"
                accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void upload(file)
                  event.currentTarget.value = ''
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
