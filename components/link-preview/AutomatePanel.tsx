'use client'

import { Check, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  type AutomationOptions,
  curlSnippet,
  githubActionsSnippet,
  nodeSnippet,
} from '@/lib/link-preview/automation'
import { cn } from '@/lib/utils'
import { copyText, normalizeUrl } from './client'
import { PANEL } from './MetadataPanels'

/** Where the generated check runs. */
export const automationTargetSchema = z.enum(['github', 'node', 'curl'])

const A = automationTargetSchema.enum
const TARGETS = [
  { id: A.github, label: 'GitHub Actions', render: githubActionsSnippet },
  { id: A.node, label: 'Node script', render: nodeSnippet },
  { id: A.curl, label: 'curl', render: curlSnippet },
]

const INPUT =
  'w-full rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-foreground ring-1 ring-white/[0.08] outline-none placeholder:text-muted-foreground focus:ring-white/25'

/**
 * Keep links healthy without opening this page: a workflow or script that
 * runs the same check through the API after every deploy and fails the run
 * when a page drops below the bar.
 */
export function AutomatePanel({ url }: { url: string }) {
  const [urls, setUrls] = useState(url)
  const [minScore, setMinScore] = useState(80)
  const [failOnErrors, setFailOnErrors] = useState(true)
  const [target, setTarget] = useState(TARGETS[0]!)
  const [copied, setCopied] = useState(false)
  const options: AutomationOptions = {
    apiOrigin: typeof window === 'undefined' ? '' : window.location.origin,
    failOnErrors,
    minScore,
    urls: urls
      .split(/\s+/)
      .map(normalizeUrl)
      .filter((value): value is string => value !== null),
  }
  const code = target.render(options)

  return (
    <div className="space-y-6">
      <section className={cn(PANEL, 'grid gap-4 p-5 md:grid-cols-[2fr_1fr]')}>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Links to check, one per line</span>
          <textarea
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            rows={4}
            className={cn(INPUT, 'resize-y font-mono')}
          />
        </label>
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Fail below score</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(event) =>
                setMinScore(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
              }
              className={INPUT}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={failOnErrors}
              onChange={(event) => setFailOnErrors(event.target.checked)}
            />
            Fail on any error
          </label>
        </div>
      </section>

      <section className={cn(PANEL, 'space-y-4 p-5')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-lg bg-muted p-[3px]"
            role="group"
            aria-label="Runs in"
          >
            {TARGETS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === target.id}
                onClick={() => setTarget(item)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
                  item.id === target.id && 'bg-background text-foreground shadow-sm'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!(await copyText(code))) return
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? <Check className="text-emerald-500" /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">
          {code}
        </pre>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="size-3.5" />
          Create an API key with the <code className="font-mono">artifact:read</code> scope in{' '}
          <a href="/workspace/developers" className="text-foreground underline underline-offset-4">
            Settings → Developers
          </a>
          , and store it as <code className="font-mono">SCREENSHOT_STUDIO_API_KEY</code>.
          {target.id === A.github &&
            ' The workflow runs after each successful deployment and on demand.'}
        </p>
      </section>
    </div>
  )
}
