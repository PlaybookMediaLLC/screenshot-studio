'use client'

import { useState } from 'react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO } from './primitives'

/** Integration examples shown in the developer section. */
export const codeTabSchema = z.enum(['curl', 'typescript', 'webhook'])

/** One integration example in the developer section. */
export type CodeTab = z.infer<typeof codeTabSchema>

const TAB = codeTabSchema.enum

const EXAMPLES: Record<CodeTab, { label: string; code: string; response: string }> = {
  curl: {
    label: 'cURL',
    code: `curl https://www.screenshot-studio.com/api/v1/releases \\
  -H "x-api-key: $SCREENSHOT_STUDIO_API_KEY" \\
  -H "Idempotency-Key: release-v2.4.0" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Recurring invoices",
    "benefitStatement": "Bill repeat customers without rebuilding the invoice.",
    "sourceUrls": [
      "https://github.com/acme/billing/pull/452",
      "https://acme.com/changelog/recurring-invoices"
    ]
  }'`,
    response: `201 Created
{
  "created": true,
  "release": { "id": "cm…", "status": "DRAFT", "title": "Recurring invoices" }
}`,
  },
  typescript: {
    label: 'TypeScript',
    code: `const res = await fetch('https://www.screenshot-studio.com/api/v1/releases', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.SCREENSHOT_STUDIO_API_KEY!,
    'Idempotency-Key': \`release-\${process.env.GITHUB_SHA}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Recurring invoices',
    benefitStatement: 'Bill repeat customers without rebuilding the invoice.',
    sourceUrls: ['https://github.com/acme/billing/pull/452'],
  }),
})

const { created, release } = await res.json()`,
    response: `// A retry with the same key returns the first result:
200 OK  { "created": false, "release": { "id": "cm…" } }`,
  },
  webhook: {
    label: 'GitHub webhook',
    code: `# GitHub › Settings › Webhooks › Add webhook
Payload URL   https://www.screenshot-studio.com/api/webhooks/source/{sourceAppId}
Content type  application/json
Secret        your source app secret   # verified as X-Hub-Signature-256
Events        Releases

# GitLab sends webhook-signature, any other pipeline signs
# X-Screenshot-Studio-Signature over the exact body bytes.`,
    response: `201 Created  { "created": true, "releaseId": "cm…" }
# Redeliveries are deduplicated by X-GitHub-Delivery.`,
  },
}

/** Strings render bright, everything else muted: enough highlighting to scan. */
function Highlighted({ code }: { code: string }) {
  const parts = code.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|#.*$)/gm)
  return (
    <>
      {parts.map((part, index) => (
        <span
          className={
            part.startsWith('#')
              ? 'text-white/30'
              : /^["'`]/.test(part)
                ? 'text-white'
                : 'text-[#a3a3a3]'
          }
          key={index}
        >
          {part}
        </span>
      ))}
    </>
  )
}

/** Tabbed request examples for creating a release from code or a webhook. */
export function CodeTabs() {
  const [tab, setTab] = useState<CodeTab>(TAB.curl)
  const example = EXAMPLES[tab]
  return (
    <div className="rounded-2xl border border-[#1f1f1f] bg-[#090909] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]">
      <div
        className="flex items-center gap-1 px-2 pb-1.5 pt-1"
        role="tablist"
        aria-label="Integration examples"
      >
        {codeTabSchema.options.map((id) => (
          <button
            aria-controls={`code-panel-${id}`}
            aria-selected={tab === id}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] transition-colors duration-150',
              tab === id ? 'bg-white/[0.09] text-white' : 'text-[#858585] hover:text-white'
            )}
            id={`code-tab-${id}`}
            key={id}
            onClick={() => setTab(id)}
            role="tab"
            type="button"
          >
            {EXAMPLES[id].label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`code-tab-${tab}`}
        className="overflow-hidden rounded-xl bg-[#121212]"
        id={`code-panel-${tab}`}
        role="tabpanel"
      >
        <pre className={cn(MONO, 'overflow-x-auto p-5 text-[12.5px] leading-[1.7]')}>
          <code>
            <Highlighted code={example.code} />
          </code>
        </pre>
        <pre
          className={cn(
            MONO,
            'overflow-x-auto border-t border-white/[0.06] bg-black/30 px-5 py-4 text-[12px] leading-[1.7] text-emerald-200/80'
          )}
        >
          {example.response}
        </pre>
      </div>
    </div>
  )
}
