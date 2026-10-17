'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  type Integration,
  type IntegrationProvider,
  integrationProviderSchema,
  PROVIDER_NAMES,
} from '@/lib/integrations/schema'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

type Setup = Record<IntegrationProvider, { missing: string[]; ready: boolean }>

const WHAT_IT_DOES: Record<IntegrationProvider, string> = {
  FIGMA:
    'Comment on a Figma file or frame with a link to the published design. Paste images into Figma from the editor.',
  NOTION: 'Add a published design, captioned, with a link to its share page, to a Notion page.',
  SLACK: 'Post a published design as a file in a channel, with your message and its share link.',
}

/**
 * Connected apps: Slack, Notion, and Figma. Owners and admins connect and
 * disconnect accounts; anyone who can edit designs delivers through them.
 * A provider not set up on this server says which settings it needs.
 */
export function WorkspaceIntegrations({ canManage }: { canManage: boolean }) {
  const trpcClient = useTRPCClient()
  const params = useSearchParams()
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [setup, setSetup] = useState<Setup | null>(null)
  const [error, setError] = useState<string | null>(params.get('error'))
  const [busy, setBusy] = useState<string | null>(null)
  const connected = params.get('connected')

  const load = useCallback(() => {
    trpcClient.integration.list
      .query()
      .then((result) => {
        setIntegrations(result.integrations)
        setSetup(result.setup)
      })
      .catch((failure: unknown) => setError(getErrorMessage(failure)))
  }, [trpcClient])

  useEffect(load, [load])

  async function disconnect(integration: Integration) {
    setBusy(integration.id)
    setError(null)
    try {
      await trpcClient.integration.disconnect.mutate({ id: integration.id })
      load()
    } catch (failure) {
      setError(getErrorMessage(failure))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {connected ? (
        <Alert>
          <AlertDescription>Connected {connected}.</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {integrationProviderSchema.options.map((provider) => {
        const accounts = integrations.filter((integration) => integration.provider === provider)
        const status = setup?.[provider]
        return (
          <Section
            description={WHAT_IT_DOES[provider]}
            key={provider}
            title={PROVIDER_NAMES[provider]}
          >
            <Group>
              {accounts.map((account) => (
                <div className="flex items-center justify-between gap-4 px-5 py-4" key={account.id}>
                  <span className="min-w-0 truncate text-sm text-white">{account.displayName}</span>
                  <div className="flex items-center gap-3">
                    <Pill tone="green">Connected</Pill>
                    {canManage ? (
                      <Button
                        disabled={busy === account.id}
                        onClick={() => void disconnect(account)}
                        size="sm"
                        variant="outline"
                      >
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <Row>
                {!status ? (
                  <p className="text-sm text-neutral-500">Loading…</p>
                ) : !status.ready ? (
                  <p className="text-sm text-neutral-400">
                    Not set up on this server. An operator must set{' '}
                    {status.missing.map((name, index) => (
                      <span key={name}>
                        {index > 0 ? ', ' : ''}
                        <code className="text-neutral-200">{name}</code>
                      </span>
                    ))}
                    . See docs/integrations.md.
                  </p>
                ) : canManage ? (
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-neutral-400">
                      {accounts.length
                        ? 'Connect another account, or reconnect to refresh access.'
                        : 'No account connected.'}
                    </p>
                    <Button asChild size="sm">
                      <a href={`/api/integrations/${provider.toLowerCase()}/connect`}>
                        Connect {PROVIDER_NAMES[provider]}
                      </a>
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500">
                    {accounts.length
                      ? 'Owners and admins manage connections.'
                      : 'Ask an owner or admin to connect an account.'}
                  </p>
                )}
              </Row>
            </Group>
          </Section>
        )
      })}
    </div>
  )
}
