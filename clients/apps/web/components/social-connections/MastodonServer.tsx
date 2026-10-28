'use client'

import { useEffect, useState } from 'react'
import { mastodonInstanceSchema, socialInstanceServerSchema } from 'screenshot-studio-backend-sdk'
import type { z } from 'zod'
import { useSocialSetScope } from '@/components/settings/social-sets/scope'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsErrorMessage } from '@/lib/settings/client'

const servers = [
  ['mastodon.social', 'General community'],
  ['fosstodon.org', 'FOSS and technology'],
  ['mas.to', 'General community'],
  ['mstdn.social', 'General community'],
  ['techhub.social', 'Technology community'],
] as const

/** A preview always belongs to its exact current input; changing it aborts the previous request. */
export function MastodonServer({
  value,
  onChange,
  onVerified,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  onVerified: (server: string, authorizationEnabled: boolean | null) => void
  disabled?: boolean
}) {
  const { ready, request } = useSocialSetScope()
  const [custom, setCustom] = useState(() => !servers.some(([host]) => host === value))
  const [result, setResult] = useState<{
    server: string
    data?: z.output<typeof mastodonInstanceSchema>
    error?: string
  } | null>(null)
  const server = value.trim()
  const valid = socialInstanceServerSchema.safeParse(server).success
  const current = result?.server === server ? result : null
  useEffect(() => {
    onVerified(server, null)
    if (!valid || !ready) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const data = await request(
          `/api/v1/social-instances/mastodon?${new URLSearchParams({ server })}`,
          mastodonInstanceSchema,
          { signal: controller.signal }
        )
        if (!controller.signal.aborted) {
          setResult({ server, data })
          onVerified(server, data.authorizationEnabled)
        }
      } catch (error) {
        if (!controller.signal.aborted) setResult({ server, error: settingsErrorMessage(error) })
      }
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [server, valid, ready, request, onVerified])
  return (
    <div className="grid gap-3">
      <Label className="grid gap-1.5 text-sm">
        <span>Mastodon server</span>
        <Select
          disabled={disabled}
          value={custom ? 'custom' : value}
          onValueChange={(next) => {
            setCustom(next === 'custom')
            onChange(next === 'custom' ? '' : next)
          }}
        >
          <SelectTrigger aria-label="Mastodon server">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {servers.map(([host, description]) => (
              <SelectItem key={host} value={host}>
                {host} · {description}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom server…</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      {custom ? (
        <Label className="grid gap-1.5 text-sm">
          <span>Custom server hostname</span>
          <Input
            disabled={disabled}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="social.example.com"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={2048}
          />
        </Label>
      ) : null}
      <div
        aria-live="polite"
        aria-busy={valid && !current}
        className="min-h-20 break-words rounded-lg border border-border bg-muted/20 p-3 text-sm"
        data-testid="mastodon-server-preview"
      >
        {!server ? (
          <p className="text-muted-foreground">Enter your server to see its public information.</p>
        ) : !valid ? (
          <p className="text-muted-foreground">
            Enter a public HTTPS server hostname without a path, port, or credentials.
          </p>
        ) : current?.error ? (
          <p role="alert" className="text-muted-foreground">
            {current.error}
          </p>
        ) : current?.data ? (
          <>
            <p className="font-medium">{current.data.title}</p>
            <p className="break-all text-xs text-muted-foreground">{current.data.origin}</p>
            <p className="mt-2 whitespace-pre-line text-muted-foreground">
              {current.data.description}
            </p>
            {current.data.activeUsers !== null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {current.data.activeUsers.toLocaleString()} active users in the past four weeks
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">Loading {server}…</p>
        )}
      </div>
      <a
        className="text-xs text-muted-foreground underline underline-offset-4"
        href="https://joinmastodon.org/servers"
        target="_blank"
        rel="noreferrer"
      >
        Find a server and create a Mastodon account
      </a>
    </div>
  )
}
