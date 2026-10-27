'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyLengthSchema, copyToneSchema, type CopyRequest } from '@/lib/api/contracts/store-screenshots'
import type { SlideScope } from '@/lib/store-screenshots/commands/schema'
import type { TextLayer } from '@/lib/store-screenshots/document/schema'
import { decodeSpans, encodeSpans, pendingTranslations } from '@/lib/store-screenshots/localization'
import { localeName } from '@/lib/store-screenshots/locales'
import { cn } from '@/lib/utils'
import { SelectField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import type { DialogProps } from './BasicDialogs'
import { requestJson } from './request'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'

const BATCH = 60


/**
 * AI translation of every text layer into the project's languages. Only the
 * text strings are sent; approved translations are skipped unless the user
 * asks to redo them, and results land as "machine" translations to review.
 */
export function TranslateDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const { sourceLocale, locales } = document.localization
  const [targets, setTargets] = React.useState<string[]>(locales)
  const [includeApproved, setIncludeApproved] = React.useState(false)
  const [includeCurrent, setIncludeCurrent] = React.useState(false)
  const [useBrief, setUseBrief] = React.useState(Boolean(document.productBrief))
  const [consent, setConsent] = React.useState(false)
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const requests = pendingTranslations(document, targets, { includeApproved, includeCurrent })
  const uniqueTexts = new Set(requests.map((request) => encodeSpans(request.source)))

  const run = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    const layerById = new Map(document.slides.flatMap((slide) => slide.layers.filter((layer): layer is TextLayer => layer.type === 'text').map((layer) => [layer.id, layer])))
    const entries: Array<{ slideId: string; layerId: string; locale: string; content: TextLayer['content']; status: 'machine' }> = []
    try {
      const byLocale = new Map<string, typeof requests>()
      for (const request of requests) byLocale.set(request.locale, [...(byLocale.get(request.locale) ?? []), request])
      const total = requests.length
      setProgress({ done: 0, total })
      let done = 0
      for (const [locale, list] of byLocale) {
        for (let start = 0; start < list.length; start += BATCH) {
          const chunk = list.slice(start, start + BATCH)
          const { translations } = await requestJson<{ translations: Array<{ id: string; text: string }> }>(
            '/api/store-screenshots/translate',
            {
              body: {
                sourceLocale,
                targetLocale: locale,
                context: useBrief ? document.productBrief : '',
                items: chunk.map((request) => ({ id: request.layerId, text: encodeSpans(request.source) })),
              },
              signal: controller.signal,
            }
          )
          const translated = new Map(translations.map((item) => [item.id, item.text]))
          for (const request of chunk) {
            const text = translated.get(request.layerId)
            const source = layerById.get(request.layerId)?.content ?? request.source
            if (text) entries.push({ slideId: request.slideId, layerId: request.layerId, locale, content: decodeSpans(text, source), status: 'machine' })
          }
          done += chunk.length
          setProgress({ done, total })
        }
      }
      if (entries.length) {
        api.getState().dispatch({ type: 'text.translate', entries })
        toast.success(`${entries.length} translations added`, { description: 'They are marked as machine translations. Review them per language before exporting.' })
      }
      onOpenChange(false)
    } catch (cause) {
      if (controller.signal.aborted) toast('Translation stopped. Nothing was changed.')
      else toast.error('Translation failed', { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (progress ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[88vh] sm:max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Translate with AI</DialogTitle>
          <DialogDescription>Creates translations you can review and edit. Your {localeName(sourceLocale)} text is never changed.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-1.5" disabled={Boolean(progress)}>
          <legend className="mb-1 text-xs font-semibold">Languages</legend>
          {locales.map((code) => (
            <Label key={code} className="flex items-center gap-2 text-xs">
              <Checkbox  checked={targets.includes(code)} onCheckedChange={(checked) => setTargets((checked === true) ? [...targets, code] : targets.filter((item) => item !== code))} />
              {localeName(code)}
            </Label>
          ))}
        </fieldset>
        <fieldset className="space-y-1.5 text-xs" disabled={Boolean(progress)}>
          <legend className="mb-1 font-semibold">Options</legend>
          <Label className="flex items-center gap-2">
            <Checkbox  checked={includeCurrent} onCheckedChange={(checked) => setIncludeCurrent((checked === true))} /> Redo drafts that are still up to date
          </Label>
          <Label className="flex items-center gap-2">
            <Checkbox  checked={includeApproved} onCheckedChange={(checked) => setIncludeApproved((checked === true))} /> Also redo approved translations
          </Label>
          <Label className="flex items-center gap-2">
            <Checkbox  checked={useBrief} disabled={!document.productBrief} onCheckedChange={(checked) => setUseBrief((checked === true))} /> Send the product brief for consistent terms
          </Label>
        </fieldset>
        <Accordion type="single" collapsible>
          <AccordionItem value="details" className="text-xs">
            <AccordionTrigger className="cursor-pointer">
              {requests.length} strings will be sent ({uniqueTexts.size} unique)
            </AccordionTrigger>
            <AccordionContent className="p-0">
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4 text-muted-foreground">
                {[...uniqueTexts].slice(0, 50).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <Label className="flex items-start gap-2 rounded-md border border-foreground/10 p-2 text-xs">
          <Checkbox  checked={consent} onCheckedChange={(checked) => setConsent((checked === true))} className="mt-0.5" />
          I may send this text (no images or screenshots) to the AI provider configured for this workspace.
        </Label>
        {progress ? (
          <div className="space-y-1.5" role="status">
            <p className="text-xs">
              Translated {progress.done} of {progress.total}
            </p>
            <progress className="h-1.5 w-full" max={progress.total} value={progress.done} aria-label="Translation progress" />
            <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!consent || requests.length === 0} onClick={() => void run()}>
              Translate {requests.length} strings
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Headline suggestions grounded in the product brief. Suggestions are kept
 * in the project so regenerating never loses earlier copy, and applying one
 * keeps the replaced copy as an "earlier" suggestion.
 */
export function CopyDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const activeSlideId = useEditor((state) => state.activeSlideId)
  const editingLocale = useEditor((state) => state.locale)
  const [brief, setBrief] = React.useState(document.productBrief)
  const [scope, setScope] = React.useState<SlideScope>('active')
  const [topics, setTopics] = React.useState<Record<string, string>>(() => Object.fromEntries(document.slides.map((slide) => [slide.id, slide.name])))
  const [tone, setTone] = React.useState<CopyRequest['tone']>('confident')
  const [length, setLength] = React.useState<CopyRequest['length']>('short')
  const [count, setCount] = React.useState(3)
  const [locale, setLocale] = React.useState(editingLocale)
  const [busy, setBusy] = React.useState(false)
  const slides = scope === 'active' ? document.slides.filter((slide) => slide.id === activeSlideId) : document.slides.slice(0, 12)
  const headlineOf = (slideId: string) => {
    const layer = document.slides.find((slide) => slide.id === slideId)?.layers.find((item): item is TextLayer => item.type === 'text' && item.role === 'heading')
    return layer ? layer.content.map((span) => span.text).join('') : ''
  }

  const generate = async () => {
    setBusy(true)
    const controller = new AbortController()
    try {
      if (brief !== document.productBrief) api.getState().dispatch({ type: 'project.patch', patch: { productBrief: brief } })
      const result = await requestJson<{ slides: Array<{ id: string; suggestions: Array<{ headline: string; subheadline: string }> }> }>(
        '/api/store-screenshots/copy',
        { body: { brief, locale, tone, length, count, slides: slides.map((slide) => ({ id: slide.id, topic: topics[slide.id] ?? slide.name, currentHeadline: headlineOf(slide.id) })) }, signal: controller.signal }
      )
      const suggestions = result.slides.flatMap((slide) =>
        slide.suggestions.map((item) => ({ id: crypto.randomUUID(), slideId: slide.id, locale, headline: item.headline, subheadline: item.subheadline, tone }))
      )
      if (suggestions.length) api.getState().dispatch({ type: 'copy.remember', suggestions })
      else toast('No suggestions met the rules. Add more product facts to the brief.')
    } catch (cause) {
      toast.error('Could not write suggestions', { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const shown = document.copySuggestions.filter((item) => slides.some((slide) => slide.id === item.slideId)).slice().reverse()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[92vh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Write headlines with AI</DialogTitle>
          <DialogDescription>Suggestions use only the facts in your brief: no invented numbers, ratings, or awards. Review every line before publishing.</DialogDescription>
        </DialogHeader>
        <Label className="block space-y-1 text-xs">
          <span className="font-semibold">Product brief</span>
          <Textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={4} maxLength={4000} placeholder="What the app does, for whom, and its key features. Paste your App Store description if you like." className="w-full rounded-md border border-foreground/10 bg-foreground/[0.035] p-2 text-xs outline-none" />
        </Label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SelectField label="Tone" value={tone} options={copyToneSchema.options.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={setTone} />
          <SelectField label="Length" value={length} options={copyLengthSchema.options.map((value) => ({ value, label: value === 'short' ? 'Short' : 'Long' }))} onChange={setLength} />
          <SelectField label="Variants" value={String(count)} options={[1, 2, 3, 4, 5, 6].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => setCount(Number(value))} />
          <SelectField label="Language" value={locale} options={[document.localization.sourceLocale, ...document.localization.locales].map((code) => ({ value: code, label: localeName(code) }))} onChange={setLocale} />
        </div>
        <div className="flex gap-3 text-xs">
          <Label className="flex items-center gap-1.5">
            <Input type="radio" name="copy-scope" checked={scope === 'active'} onChange={() => setScope('active')} /> This slide
          </Label>
          <Label className="flex items-center gap-1.5">
            <Input type="radio" name="copy-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All slides
          </Label>
        </div>
        <div className="space-y-1.5">
          {slides.map((slide) => (
            <Label key={slide.id} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-muted-foreground">{slide.name}</span>
              <Input value={topics[slide.id] ?? ''} onChange={(event) => setTopics({ ...topics, [slide.id]: event.target.value })} placeholder="What this screen shows" aria-label={`What ${slide.name} shows`} className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 outline-none" />
            </Label>
          ))}
        </div>
        <Button disabled={busy || brief.trim().length < 20} onClick={() => void generate()}>
          {busy ? 'Writing…' : 'Suggest headlines'}
        </Button>
        {shown.length ? (
          <ul className="space-y-2" aria-label="Suggestions">
            {shown.map((item) => (
              <li key={item.id} className={cn('flex items-start gap-3 rounded-md border p-2', item.appliedAt ? 'border-emerald-500/40' : 'border-foreground/10')}>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-semibold">{item.headline || '(no headline)'}</p>
                  {item.subheadline ? <p className="text-muted-foreground">{item.subheadline}</p> : null}
                  <p className="text-[10px] text-muted-foreground">
                    {document.slides.find((slide) => slide.id === item.slideId)?.name} · {localeName(item.locale)} · {item.tone === 'previous' ? 'earlier copy' : item.tone}
                    {item.appliedAt ? ' · applied' : ''}
                  </p>
                </div>
                <Button size="sm" variant={item.tone === 'previous' ? 'outline' : 'default'} onClick={() => api.getState().dispatch({ type: 'copy.apply', suggestionId: item.id })}>
                  {item.tone === 'previous' ? 'Restore' : 'Apply'}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
