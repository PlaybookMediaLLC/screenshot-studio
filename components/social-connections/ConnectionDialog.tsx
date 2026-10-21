'use client'

import { ArrowUpRight, ChevronRight, LockKeyhole, Newspaper, Users, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  socialOAuthBeginRequestSchema,
  socialOAuthBeginResponseSchema,
  socialOAuthProviderSchema,
} from 'screenshot-studio-backend-sdk'
import { ChannelIcon } from '@/components/drafts/channel-meta'
import { useSocialSetScope } from '@/components/settings/social-sets/scope'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { settingsErrorMessage } from '@/lib/settings/client'
import type { ConnectionLauncherProps } from './ConnectionLauncher'
import { MastodonServer } from './MastodonServer'

const providers = [
  { id: 'x', label: 'X / Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'mastodon', label: 'Mastodon' },
  { id: 'threads', label: 'Threads' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'substack', label: 'Substack Notes' },
  { id: 'instagram-standalone', label: 'Instagram' },
] as const

/** A local provider step owns its request lifetime, so leaving it cannot navigate later. */
function ProviderForm({
  provider,
  intent,
  target,
}: Omit<ConnectionLauncherProps, 'children'> & { provider: string }) {
  const scope = useSocialSetScope()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mastodonServer, setMastodonServer] = useState('mastodon.social')
  const lifetime = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      lifetime.current = null
    }
  }, [])
  const label =
    provider === 'x' ? 'X' : (providers.find((item) => item.id === provider)?.label ?? provider)
  const supported = socialOAuthProviderSchema.safeParse(provider)
  const serverAvailable = provider !== 'mastodon' || mastodonServer === 'mastodon.social'
  const connect = async () => {
    const controller = lifetime.current
    if (!supported.success || !serverAvailable || !controller || busy) return
    setBusy(true)
    setError('')
    try {
      const body = socialOAuthBeginRequestSchema.parse({ ...intent, provider: supported.data })
      const result = await scope.request(
        '/api/v1/social-connection-attempts',
        socialOAuthBeginResponseSchema,
        {
          method: 'POST',
          body,
          signal: controller.signal,
        }
      )
      if (!controller.signal.aborted) window.location.assign(result.url)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(settingsErrorMessage(cause))
        setBusy(false)
      }
    }
  }
  return (
    <div className="grid gap-5">
      {provider === 'substack' ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Substack Notes are short posts on a Substack profile. Substack does not offer a public
          publishing API, so connecting Notes is currently unavailable. This connection would not
          publish newsletters or articles.{' '}
          <a
            className="underline underline-offset-4"
            href="https://support.substack.com/hc/en-us/articles/360038433912-Does-Substack-have-an-API"
            target="_blank"
            rel="noreferrer"
          >
            Substack API information
          </a>
        </p>
      ) : provider === 'bluesky' ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Bluesky uses a handle and an app password. This connection method is not available in this
          dialog yet.
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You’ll go to {label} to choose an account and authorize Shots, then return here to
            finish the connection.
          </p>
          {provider === 'x' ? (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
              Signed in to more than one X account? Check the account you want to connect before
              authorizing.{' '}
              <a
                className="underline underline-offset-4"
                href="https://x.com/account/switch"
                target="_blank"
                rel="noreferrer"
              >
                Switch X account
              </a>
            </p>
          ) : null}
          {provider === 'mastodon' ? (
            <>
              <MastodonServer value={mastodonServer} onChange={setMastodonServer} />
              {!serverAvailable && mastodonServer.trim() ? (
                <p className="text-sm text-muted-foreground">
                  Authorization on this server is not enabled yet.
                </p>
              ) : null}
            </>
          ) : null}
          {intent.operation === 'RECONNECT' ? (
            <p className="text-sm text-muted-foreground">
              Choose the same account already connected to {target?.name ?? 'this brand'}.
              Reconnecting preserves its drafts and schedule; it cannot replace the account with
              another identity.
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={!supported.success || !serverAvailable || busy || !scope.ready}
        onClick={() => void connect()}
        type="button"
      >
        {busy
          ? 'Opening authorization…'
          : supported.success
            ? `Connect ${label} account`
            : 'Connection unavailable'}
        {supported.success && !busy ? <ArrowUpRight className="size-4" aria-hidden /> : null}
      </Button>
    </div>
  )
}

/** Provider selection never creates a set; the backend commits it with its first verified account. */
export default function ConnectionDialog({
  intent,
  target,
  initialProvider,
  onClose,
}: ConnectionLauncherProps & { onClose: () => void }) {
  const [provider, setProvider] = useState<string | null>(initialProvider ?? null)
  const lastProvider = useRef<string | null>(initialProvider ?? null)
  const heading = useRef<HTMLHeadingElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const creating = intent.operation === 'CREATE_SET'
  const label =
    provider === 'x' ? 'X' : (providers.find((item) => item.id === provider)?.label ?? provider)
  const close = () => {
    if (provider) {
      lastProvider.current = provider
      setProvider(null)
    } else onClose()
  }
  useLayoutEffect(() => {
    if (provider) heading.current?.focus()
    else if (lastProvider.current)
      picker.current
        ?.querySelector<HTMLButtonElement>(`[data-provider="${lastProvider.current}"]`)
        ?.focus()
  }, [provider])
  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
      showCloseButton={false}
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        close()
      }}
      onPointerDownOutside={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <button
        aria-label={provider ? 'Back to platforms' : 'Close'}
        className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onClick={close}
        type="button"
      >
        <X aria-hidden className="size-4" />
      </button>
      <DialogHeader className="pr-7">
        <DialogTitle ref={heading} tabIndex={-1} className="leading-snug outline-none">
          {provider
            ? `${intent.operation === 'RECONNECT' ? 'Reconnect' : 'Connect'} ${label} account`
            : creating
              ? 'Create a social set'
              : `Add account to “${target?.name ?? 'this brand'}”`}
        </DialogTitle>
        <DialogDescription>
          {provider
            ? 'Your accounts stay in the brand you chose.'
            : creating
              ? 'Choose the first platform for this person or brand. Your set is created when the account connects.'
              : 'One account per platform. Choose another platform to add to this set.'}
        </DialogDescription>
      </DialogHeader>
      {!provider ? (
        <>
          {creating ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {intent.creationVisibility === 'PRIVATE' ? (
                <LockKeyhole className="size-3.5" aria-hidden />
              ) : (
                <Users className="size-3.5" aria-hidden />
              )}
              {intent.creationVisibility === 'PRIVATE'
                ? 'Private to you in this workspace'
                : 'Shared with this workspace'}
            </p>
          ) : null}
          <div className="grid gap-2" ref={picker}>
            {providers.map((item) => {
              const channel = channelForPlatform(item.id)
              const occupied =
                intent.operation !== 'RECONNECT' &&
                target?.accounts.some(
                  (account) => channelForPlatform(account.platform) === channel && channel !== null
                )
              return (
                <Button
                  key={item.id}
                  data-provider={item.id}
                  disabled={occupied}
                  variant="outline"
                  className="h-12 w-full justify-start gap-3"
                  onClick={() => setProvider(item.id)}
                  type="button"
                >
                  {channel ? (
                    <ChannelIcon channel={channel} className="size-5" />
                  ) : (
                    <Newspaper className="size-5" aria-hidden />
                  )}
                  <span className="flex-1 text-left">{item.label}</span>
                  {occupied ? (
                    <span className="text-xs">Connected</span>
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </Button>
              )
            })}
          </div>
        </>
      ) : (
        <ProviderForm key={provider} provider={provider} intent={intent} target={target} />
      )}
      {provider ? (
        <Button type="button" variant="ghost" onClick={close}>
          Close
        </Button>
      ) : null}
    </DialogContent>
  )
}
