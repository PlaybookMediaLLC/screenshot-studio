'use client'

import * as React from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { localeName } from '@/lib/store-screenshots/locales'
import { getStoreTargetOrDefault, STORE_TARGETS, targetPixelSize } from '@/lib/store-screenshots/targets'
import { cn } from '@/lib/utils'
import { useEditor } from '../editor-store'
import { SlideThumbnail } from '../SlideThumbnail'
import type { DialogProps } from './BasicDialogs'

/**
 * Simulated store listings: how the first screenshots read in App Store
 * search results, on the App Store product page, and in a Google Play
 * listing, in light and dark appearance. These are approximations of the
 * current layouts; real stores vary by device, region, experiments, and app
 * version.
 */

/** Simulated surfaces. */
export const previewSurfaceSchema = z.enum(['app-store-search', 'app-store-product', 'google-play'])

/** A simulated surface. */
export type PreviewSurface = z.infer<typeof previewSurfaceSchema>

const SURFACES: Record<PreviewSurface, string> = {
  'app-store-search': 'App Store search',
  'app-store-product': 'App Store product page',
  'google-play': 'Google Play listing',
}

function AppIcon({ name, dark }: { name: string; dark: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex size-[52px] shrink-0 items-center justify-center rounded-[12px] text-lg font-semibold', dark ? 'bg-zinc-700 text-white' : 'bg-zinc-200 text-zinc-700')} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

/** The store preview dialog. */
export function StorePreviewDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const document = useEditor((state) => state.document)
  const locale = useEditor((state) => state.locale)
  const [surface, setSurface] = React.useState<PreviewSurface>('app-store-search')
  const [dark, setDark] = React.useState(false)
  const [appName, setAppName] = React.useState(document.name)
  const [subtitle, setSubtitle] = React.useState('Your subtitle here')
  const apple = surface !== 'google-play'
  const [appleTargetId, setAppleTargetId] = React.useState('ios-iphone-6.3')
  const targetId = apple ? appleTargetId : 'play-phone'
  const size = targetPixelSize(getStoreTargetOrDefault(targetId))
  const thumbnails = (count: number, height: number) =>
    document.slides.slice(0, count).map((slide, index) => (
      <SlideThumbnail key={slide.id} document={document} index={index} size={size} targetId={targetId} locale={locale} height={height} className={cn('shrink-0', apple ? 'rounded-[10px]' : 'rounded-[8px]')} />
    ))
  const text = dark ? 'text-white' : 'text-zinc-900'
  const muted = dark ? 'text-zinc-400' : 'text-zinc-500'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Store preview</DialogTitle>
          <DialogDescription>A simulation of how your first screenshots appear in store listings ({localeName(locale)}). Real store layouts vary by device, region, experiments, and app version.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div role="tablist" aria-label="Store surface" className="flex gap-1">
            {previewSurfaceSchema.options.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={surface === item} onClick={() => setSurface(item)} className={cn('h-8 rounded-md px-2.5', surface === item ? 'bg-foreground text-background' : 'border border-foreground/10')}>
                {SURFACES[item]}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} /> Dark appearance
          </label>
          {apple ? (
            <select aria-label="Screenshot size" value={appleTargetId} onChange={(event) => setAppleTargetId(event.target.value)} className="h-8 rounded-md border border-foreground/10 bg-background px-2">
              {STORE_TARGETS.filter((target) => target.store === 'app-store' && target.family === 'phone').map((target) => (
                <option key={target.id} value={target.id}>
                  {target.shortName}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            <span className="text-muted-foreground">App name</span>
            <input value={appName} onChange={(event) => setAppName(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-foreground/10 bg-background px-2" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">{apple ? 'Subtitle' : 'Developer'}</span>
            <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-foreground/10 bg-background px-2" />
          </label>
        </div>

        <div className="flex justify-center rounded-xl bg-foreground/[0.04] p-6">
          <div className={cn('w-[390px] overflow-hidden rounded-[36px] border-[10px] border-zinc-900 font-sans shadow-2xl', dark ? 'bg-black' : 'bg-white')} aria-label={`${SURFACES[surface]} simulation`} role="img">
            <div className="flex h-11 items-center justify-between px-6 text-[13px] font-semibold">
              <span className={text}>9:41</span>
              <span className={muted}>● ● ●</span>
            </div>
            {surface === 'app-store-search' ? (
              <div className="space-y-3 px-4 pb-6">
                <div className={cn('h-9 rounded-[10px] px-3 py-2 text-[15px]', dark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-500')}>{appName.toLowerCase()}</div>
                <div className="flex items-center gap-3">
                  <AppIcon name={appName} dark={dark} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-[15px] font-semibold', text)}>{appName}</p>
                    <p className={cn('truncate text-[13px]', muted)}>{subtitle}</p>
                  </div>
                  <span className="rounded-full bg-[#0A84FF]/15 px-4 py-1 text-[13px] font-semibold text-[#0A84FF]">Get</span>
                </div>
                <div className="flex justify-between gap-2">{thumbnails(3, 218)}</div>
              </div>
            ) : surface === 'app-store-product' ? (
              <div className="space-y-4 pb-6">
                <div className="flex items-center gap-3 px-4">
                  <AppIcon name={appName} dark={dark} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-[20px] font-bold', text)}>{appName}</p>
                    <p className={cn('truncate text-[14px]', muted)}>{subtitle}</p>
                  </div>
                </div>
                <div className="flex gap-2 overflow-hidden pl-4">{thumbnails(4, 470)}</div>
              </div>
            ) : (
              <div className="space-y-4 pb-6">
                <div className="flex items-center gap-3 px-4">
                  <AppIcon name={appName} dark={dark} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-[20px] font-medium', text)}>{appName}</p>
                    <p className="truncate text-[14px] font-medium text-[#01875f]">{subtitle}</p>
                  </div>
                </div>
                <div className="px-4">
                  <span className="block rounded-full bg-[#01875f] py-2 text-center text-[14px] font-medium text-white">Install</span>
                </div>
                <div className="flex gap-2 overflow-hidden pl-4">{thumbnails(4, 300)}</div>
              </div>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Search results show the first three portrait screenshots side by side, so slides 1 to 3 carry most of the first impression. Ratings and reviews are left out on purpose: they come from the store, not from your screenshots.
        </p>
      </DialogContent>
    </Dialog>
  )
}
