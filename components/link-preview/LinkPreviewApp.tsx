'use client'

import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type LinkPreview,
  type LinkPreviewAgent,
  linkPreviewAgentSchema,
} from '@/lib/api/contracts/link-preview'
import { auditLinkPreview, issueSeveritySchema } from '@/lib/link-preview/audit'
import { CRAWLERS } from '@/lib/link-preview/crawlers'
import { scoreLinkPreview } from '@/lib/link-preview/metadata'
import {
  type LinkPreviewSnapshot,
  linkPreviewSnapshotSchema,
  snapshotOf,
} from '@/lib/link-preview/history'
import { applyEdits, markdownReport, NO_EDITS } from '@/lib/link-preview/snippets'
import { cn } from '@/lib/utils'
import { AutomatePanel } from './AutomatePanel'
import { BatchCheck } from './BatchCheck'
import { copyText, normalizeUrl, requestPreview } from './client'
import { CompareView } from './CompareView'
import { CrawlerMatrix } from './CrawlerMatrix'
import { ExtrasPanel } from './ExtrasPanel'
import { FixPanel } from './FixPanel'
import { HistoryCard } from './HistoryCard'
import { JavaScriptCheck } from './JavaScriptCheck'
import { ImageStudio } from './ImageStudio'
import {
  BasicPanel,
  ImagesPanel,
  OpenGraphPanel,
  OverviewPanel,
  PANEL,
  RawPanel,
  TechnicalPanel,
  XCardPanel,
} from './MetadataPanels'
import {
  AllPreviews,
  CacheRefresh,
  hostname,
  PLATFORMS,
  PlatformPreview,
  type PreviewDevice,
  previewDeviceSchema,
  previewPlatformSchema,
  type PreviewTheme,
  previewThemeSchema,
} from './PlatformPreviews'
import { PostComposer, SharePanel } from './SharePanel'

const EXAMPLES = ['shot.playbookmedia.io', 'linear.app', 'vercel.com']
const RECENT_KEY = 'link-preview:recent'
const MAX_RECENT = 10

/** Check one link in depth, many at once, or two side by side. */
export const linkPreviewModeSchema = z.enum(['single', 'batch', 'compare'])

/** The result tabs, in order. */
export const linkPreviewTabSchema = z.enum([
  'overview',
  'previews',
  'fix',
  'share',
  'extras',
  'basic',
  'opengraph',
  'x',
  'images',
  'technical',
  'automate',
  'raw',
])

/** Which preview is showing: every platform, or one. */
export const platformViewSchema = z.enum(['all', ...previewPlatformSchema.options])

const MODE = linkPreviewModeSchema.enum
const TAB = linkPreviewTabSchema.enum
const ALL = platformViewSchema.enum.all

const TAB_LABELS: Record<z.infer<typeof linkPreviewTabSchema>, string> = {
  automate: 'Automate',
  basic: 'Basic',
  extras: 'More tags',
  fix: 'Fix',
  images: 'Images',
  opengraph: 'Open Graph',
  overview: 'Overview',
  previews: 'Previews',
  raw: 'Raw',
  share: 'Share',
  technical: 'Technical',
  x: 'X',
}

const MODE_LABELS: Record<z.infer<typeof linkPreviewModeSchema>, string> = {
  batch: 'Batch',
  compare: 'Compare',
  single: 'One link',
}

const TAB_LIST =
  'h-auto w-max min-w-full justify-start rounded-none border-b border-border bg-transparent p-0'
const TAB_TRIGGER =
  'h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 py-3 text-xs uppercase tracking-wide data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none'

const LOCALHOST_STEPS = [
  { label: 'Install ngrok', command: 'bun add -g ngrok' },
  { label: 'Start your local server on port 3000' },
  { label: 'Open a tunnel', command: 'ngrok http 3000' },
  { label: 'Paste the https URL ngrok prints' },
]

const historyKey = (url: string) => `link-preview:history:${url}`

/** Earlier checks of `url` in this browser, newest first. */
function readHistory(url: string): LinkPreviewSnapshot[] {
  try {
    const stored = z
      .array(linkPreviewSnapshotSchema)
      .safeParse(JSON.parse(localStorage.getItem(historyKey(url)) ?? '[]'))
    return stored.success ? stored.data : []
  } catch {
    return []
  }
}

/** Remember `snapshot` as the newest check of `url`, keeping the last ten. */
function recordHistory(url: string, snapshot: LinkPreviewSnapshot): LinkPreviewSnapshot[] {
  const entries = [snapshot, ...readHistory(url)].slice(0, 10)
  try {
    localStorage.setItem(historyKey(url), JSON.stringify(entries))
  } catch {
    // Storage is unavailable in some private modes; history is a convenience.
  }
  return entries
}

function Toggle<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: T) => void
  options: Array<{ id: T; label: string }>
  value: T
}) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors',
            value === option.id && 'bg-background text-foreground shadow-sm'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function readRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(urls: string[]) {
  try {
    if (urls.length) localStorage.setItem(RECENT_KEY, JSON.stringify(urls))
    else localStorage.removeItem(RECENT_KEY)
  } catch {
    // Storage is unavailable in some private modes; recents are a convenience.
  }
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  )
}

/** This page's address with the check in the query, so it can be shared or reopened. */
function shareUrl(url: string, agent: LinkPreviewAgent): string {
  const share = new URL(window.location.href)
  share.search = ''
  share.searchParams.set('url', url)
  if (agent !== linkPreviewAgentSchema.enum.default) share.searchParams.set('agent', agent)
  return share.toString()
}

function CopyButton({ icon, label, text }: { icon: ReactNode; label: string; text: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        if (!(await copyText(text()))) return
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? <Check className="text-emerald-500" /> : icon}
      {copied ? 'Copied' : label}
    </Button>
  )
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm">{command}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${command}`}
        onClick={async () => {
          if (!(await copyText(command))) return
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? <Check className="text-emerald-500" /> : <Copy />}
      </Button>
    </div>
  )
}

function UrlList({ urls, onPick }: { urls: string[]; onPick: (url: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2">
      {urls.map((url) => (
        <li key={url}>
          <button
            type="button"
            onClick={() => onPick(url)}
            className="flex items-center gap-2 text-sm text-foreground transition-colors hover:text-foreground/70"
          >
            <span className="text-muted-foreground">›</span>
            {hostname(url)}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Paste a URL and see its score and every issue with the fix, its card on
 * thirteen platforms, a live editor that writes the corrected tags, image and
 * crawler checks, and every tag behind them. Or check a batch of links.
 */
export function LinkPreviewApp() {
  const [mode, setMode] = useState<z.infer<typeof linkPreviewModeSchema>>(MODE.single)
  const [agent, setAgent] = useState<LinkPreviewAgent>(linkPreviewAgentSchema.enum.default)
  const [input, setInput] = useState('')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [edits, setEdits] = useState(NO_EDITS)
  const [post, setPost] = useState('')
  const [theme, setTheme] = useState<PreviewTheme>(previewThemeSchema.enum.dark)
  const [device, setDevice] = useState<PreviewDevice>(previewDeviceSchema.enum.desktop)
  const [history, setHistory] = useState<LinkPreviewSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [tab, setTab] = useState<string>(TAB.overview)
  const [platform, setPlatform] = useState<string>(ALL)
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = useRef<AbortController | null>(null)

  const issues = useMemo(() => (preview ? auditLinkPreview(preview) : []), [preview])
  const edited = useMemo(() => preview && applyEdits(preview, edits), [preview, edits])
  const hasEdits = Object.values(edits).some((value) => value.trim())

  const check = useCallback(async (value: string, as: LinkPreviewAgent) => {
    const target = normalizeUrl(value)
    if (!target) {
      setError('Enter a valid http or https URL.')
      return
    }
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setMode(MODE.single)
    setInput(target)
    setUrl(target)
    setPreview(null)
    setEdits(NO_EDITS)
    setError('')
    setLoading(true)
    try {
      const result = await requestPreview(target, as, controller.signal)
      setPreview(result)
      setHistory(
        recordHistory(
          result.url,
          snapshotOf(result, scoreLinkPreview(result).score, auditLinkPreview(result))
        )
      )
      setTab(TAB.overview)
      window.history.replaceState(null, '', shareUrl(target, as))
      const next = [target, ...readRecent().filter((item) => item !== target)].slice(0, MAX_RECENT)
      writeRecent(next)
      setRecent(next)
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'The page could not be read.')
    } finally {
      if (pending.current === controller) setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    pending.current?.abort()
    setInput('')
    setUrl('')
    setPreview(null)
    setEdits(NO_EDITS)
    setError('')
    setLoading(false)
  }, [])

  // Open a shared check: /link-preview?url=…&agent=…
  useEffect(() => {
    setRecent(readRecent())
    const params = new URLSearchParams(window.location.search)
    const shared = params.get('url')
    const sharedAgent = linkPreviewAgentSchema.safeParse(params.get('agent'))
    const as = sharedAgent.success ? sharedAgent.data : linkPreviewAgentSchema.enum.default
    setAgent(as)
    if (shared) check(shared, as)
  }, [check])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Leave Escape to menus and dialogs that have focus.
        if (event.target === document.body || event.target === inputRef.current) clear()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r' && url) {
        event.preventDefault()
        check(url, agent)
        return
      }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        inputRef.current?.focus()
        return
      }
      const digit = Number(event.key)
      if (!preview || !Number.isInteger(digit) || digit < 1) return
      const view = digit === 1 ? ALL : PLATFORMS[digit - 2]?.id
      if (view) {
        setTab(TAB.previews)
        setPlatform(view)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [agent, check, clear, preview, url])

  const idle = !preview && !loading && !error
  /** Try an image in every preview, without changing the page. */
  const tryImage = (image: string) => {
    setEdits((current) => ({ ...current, image }))
    setTab(TAB.previews)
    setPlatform(ALL)
  }
  const pick = (picked: string) => check(picked, agent)
  const flagged = issues.filter((issue) => issue.severity !== issueSeveritySchema.enum.info).length

  return (
    <div className="w-full max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label="Mode">
          {linkPreviewModeSchema.options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
                mode === option && 'bg-background text-foreground shadow-sm'
              )}
            >
              {MODE_LABELS[option]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Fetch as
          <select
            value={agent}
            onChange={(event) => setAgent(linkPreviewAgentSchema.parse(event.target.value))}
            className="rounded-md bg-white/[0.04] px-2 py-1.5 text-sm text-foreground ring-1 ring-white/[0.08] outline-none"
          >
            {linkPreviewAgentSchema.options.map((option) => (
              <option key={option} value={option}>
                {option === linkPreviewAgentSchema.enum.default
                  ? 'Preview bot'
                  : `${CRAWLERS[option].name} (${CRAWLERS[option].token})`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === MODE.batch ? (
        <BatchCheck agent={agent} onOpen={pick} />
      ) : mode === MODE.compare ? (
        <CompareView agent={agent} />
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              check(input, agent)
            }}
            className={cn(PANEL, 'flex items-center gap-1 p-2')}
          >
            <input
              ref={inputRef}
              type="text"
              inputMode="url"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Enter a URL, like example.com"
              aria-label="URL to preview"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground"
            />
            {input && !loading && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={clear}
                aria-label="Clear"
              >
                <X />
              </Button>
            )}
            {url && !loading && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => check(url, agent)}
                aria-label="Check again"
              >
                <RefreshCw />
              </Button>
            )}
            <Button type="submit" disabled={loading || !input.trim()} className="h-11 px-5">
              {loading && <Loader2 className="animate-spin" />}
              Preview
            </Button>
          </form>
          <p className="mt-3 hidden text-xs text-muted-foreground sm:block">
            <kbd className="font-mono">/</kbd> focus · <kbd className="font-mono">Esc</kbd> clear ·{' '}
            <kbd className="font-mono">⌘/Ctrl R</kbd> check again ·{' '}
            <kbd className="font-mono">1</kbd> all previews · <kbd className="font-mono">2</kbd>–
            <kbd className="font-mono">9</kbd> one platform
          </p>

          {idle && (
            <div className="mt-10 space-y-8">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Try these</p>
                <UrlList urls={EXAMPLES} onPick={pick} />
              </div>
              {recent.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Recent</p>
                    <button
                      type="button"
                      onClick={() => {
                        writeRecent([])
                        setRecent([])
                      }}
                      className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="size-3.5" />
                      Clear
                    </button>
                  </div>
                  <UrlList urls={recent} onPick={pick} />
                </div>
              )}
              <details className="group space-y-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                  Testing localhost
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <p className="pt-3 text-sm text-muted-foreground">
                  Previews are read from our servers, so they cannot reach your machine. Tunnel your
                  local server with ngrok and preview the public URL.
                </p>
                <ol className="space-y-3">
                  {LOCALHOST_STEPS.map((step, index) => (
                    <li key={step.label} className="space-y-1.5">
                      <p className="text-xs uppercase text-muted-foreground">
                        {index + 1}. {step.label}
                      </p>
                      {step.command && <CopyCommand command={step.command} />}
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center gap-3 py-24" role="status">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Reading the page, its images, and its robots.txt…
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="size-8 text-destructive" />
              </div>
              <h2 className="mb-2 text-xl font-semibold">Unable to fetch preview</h2>
              <p className="max-w-md text-muted-foreground" role="alert">
                {error}
              </p>
              <Button onClick={clear} variant="outline" className="mt-4">
                Try another URL
              </Button>
              {url && (
                <div className="mt-10 w-full text-left">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Blocked by bot protection or a firewall? See which platform crawlers get
                    through.
                  </p>
                  <CrawlerMatrix key={url} url={url} />
                </div>
              )}
            </div>
          )}

          {preview && edited && !loading && (
            <>
              <div className="mt-8 flex flex-wrap items-center gap-2">
                <CopyButton
                  icon={<Link2 />}
                  label="Copy share link"
                  text={() => shareUrl(url, agent)}
                />
                <CopyButton
                  icon={<FileText />}
                  label="Copy report"
                  text={() => markdownReport(preview, scoreLinkPreview(preview).score, issues)}
                />
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  <ExternalLink />
                  Open page
                </a>
              </div>
              <Tabs value={tab} onValueChange={setTab} className="mt-6 gap-8">
                <div className="overflow-x-auto">
                  <TabsList className={TAB_LIST}>
                    {linkPreviewTabSchema.options.map((value) => (
                      <TabsTrigger key={value} value={value} className={TAB_TRIGGER}>
                        {TAB_LABELS[value]}
                        {value === TAB.overview && flagged > 0 && (
                          <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-300">
                            {flagged}
                          </span>
                        )}
                        {value === TAB.fix && hasEdits && (
                          <span className="ml-1.5 size-1.5 rounded-full bg-sky-400" />
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                <TabsContent value={TAB.overview} className="space-y-6">
                  <HistoryCard entries={history} />
                  <JavaScriptCheck key={preview.url} preview={preview} />
                  <OverviewPanel preview={preview} issues={issues} />
                </TabsContent>
                <TabsContent value={TAB.previews} className="space-y-6">
                  {hasEdits && (
                    <p className="flex items-center justify-between rounded-lg bg-sky-500/10 px-4 py-2 text-sm text-sky-200">
                      Showing your edits from the Fix tab.
                      <button
                        type="button"
                        onClick={() => setEdits(NO_EDITS)}
                        className="text-xs underline-offset-4 hover:underline"
                      >
                        Show the live page
                      </button>
                    </p>
                  )}
                  <PostComposer post={post} onChange={setPost} url={url} />
                  <div className="flex flex-wrap gap-2">
                    <Toggle
                      label="Theme"
                      value={theme}
                      onChange={setTheme}
                      options={[
                        { id: previewThemeSchema.enum.dark, label: 'Dark' },
                        { id: previewThemeSchema.enum.light, label: 'Light' },
                      ]}
                    />
                    <Toggle
                      label="Device"
                      value={device}
                      onChange={setDevice}
                      options={[
                        { id: previewDeviceSchema.enum.desktop, label: 'Desktop' },
                        { id: previewDeviceSchema.enum.mobile, label: 'Mobile' },
                      ]}
                    />
                  </div>
                  <Tabs value={platform} onValueChange={setPlatform} className="gap-8">
                    <div className="overflow-x-auto">
                      <TabsList className={TAB_LIST}>
                        <TabsTrigger value={ALL} className={TAB_TRIGGER}>
                          All
                        </TabsTrigger>
                        {PLATFORMS.map((item) => (
                          <TabsTrigger key={item.id} value={item.id} className={TAB_TRIGGER}>
                            {item.name}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                    <TabsContent
                      value={ALL}
                      className={cn(
                        theme === previewThemeSchema.enum.light && 'rounded-2xl bg-[#f3f4f6] p-6'
                      )}
                    >
                      <AllPreviews
                        device={device}
                        post={post}
                        preview={edited}
                        theme={theme}
                        url={url}
                      />
                    </TabsContent>
                    {PLATFORMS.map((item) => (
                      <TabsContent
                        key={item.id}
                        value={item.id}
                        className={cn(
                          theme === previewThemeSchema.enum.light && 'rounded-2xl bg-[#f3f4f6] p-6'
                        )}
                      >
                        <PlatformPreview
                          device={device}
                          platform={item}
                          post={post}
                          preview={edited}
                          theme={theme}
                          url={url}
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                  <CacheRefresh url={preview.url} />
                </TabsContent>
                <TabsContent value={TAB.fix}>
                  <FixPanel
                    agent={agent}
                    preview={preview}
                    edited={edited}
                    edits={edits}
                    onEdit={setEdits}
                    url={url}
                  />
                </TabsContent>
                <TabsContent value={TAB.share}>
                  <SharePanel
                    canonical={!!preview.canonical}
                    post={post}
                    url={preview.canonical || preview.url}
                  />
                </TabsContent>
                <TabsContent value={TAB.extras}>
                  <ExtrasPanel preview={preview} />
                </TabsContent>
                <TabsContent value={TAB.automate}>
                  <AutomatePanel url={preview.url} />
                </TabsContent>
                <TabsContent value={TAB.basic}>
                  <BasicPanel preview={preview} />
                </TabsContent>
                <TabsContent value={TAB.opengraph}>
                  <OpenGraphPanel preview={preview} />
                </TabsContent>
                <TabsContent value={TAB.x}>
                  <XCardPanel preview={preview} />
                </TabsContent>
                <TabsContent value={TAB.images} className="space-y-6">
                  <ImageStudio preview={preview} url={url} onUse={tryImage} />
                  <ImagesPanel preview={preview} onUse={tryImage} />
                </TabsContent>
                <TabsContent value={TAB.technical} className="space-y-6">
                  <CrawlerMatrix key={preview.url} url={preview.url} />
                  <TechnicalPanel preview={preview} />
                </TabsContent>
                <TabsContent value={TAB.raw}>
                  <RawPanel preview={preview} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
    </div>
  )
}
