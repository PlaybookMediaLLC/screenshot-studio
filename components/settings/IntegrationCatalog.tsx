'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { z } from 'zod'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { settingsErrorMessage } from '@/lib/settings/client'
import { useTRPCClient } from '@/lib/trpc/react'

/** Where an integration stands in this workspace. */
const statusSchema = z.enum(['connected', 'available', 'not_configured', 'not_available'])

type Status = z.infer<typeof statusSchema>

type Entry = {
  /** What to do to connect it, as a link inside Shots or a public page. */
  action?: { external?: boolean; href: string; label: string }
  authorization: string
  name: string
  purpose: string
  scopes: string
  setup: string
  status: Status
}

const STATUS_LABELS: Record<Status, { label: string; tone: 'gray' | 'green' | 'yellow' | 'blue' }> =
  {
    available: { label: 'Available', tone: 'blue' },
    connected: { label: 'Connected', tone: 'green' },
    not_available: { label: 'Not available', tone: 'gray' },
    not_configured: { label: 'Needs server setup', tone: 'yellow' },
  }

/**
 * Agents and integrations (RFC 043): every entry the Typefully settings name,
 * with its real state here. An entry with nothing behind it says so and offers
 * no Connect button.
 */
export function IntegrationCatalog({ canManage }: { canManage: boolean }) {
  const trpcClient = useTRPCClient()
  const integrations = useQuery({
    queryFn: () => trpcClient.integration.list.query(),
    queryKey: ['integrations', 'catalog'],
  })
  const agents = useQuery({
    enabled: canManage,
    queryFn: () => trpcClient.apiKey.list.query(),
    queryKey: ['api-keys', 'agents'],
  })
  const agentClients = (agents.data?.keys ?? [])
    .filter((key) => key.agentClient)
    .map((key) => key.agentClient ?? '')
  const connected = (provider: 'NOTION' | 'SLACK') =>
    (integrations.data?.integrations ?? []).some((item) => item.provider === provider)
  const missing = (provider: 'NOTION' | 'SLACK') =>
    integrations.data?.setup[provider].ready === false
  const agentStatus = (name: string): Status =>
    agentClients.some((client) => client.toLowerCase().includes(name.toLowerCase()))
      ? statusSchema.enum.connected
      : statusSchema.enum.available

  const entries: Entry[] = [
    {
      action: { href: '/workspace/ai-agents', label: 'Set up' },
      authorization:
        'OAuth consent by a workspace owner or admin; it mints a scoped workspace key.',
      name: 'Claude',
      purpose:
        'Draft launches, read releases and campaigns from Claude.ai, Claude Desktop and Claude Code.',
      scopes: 'artifact:read and release:create by default; you choose more.',
      setup: 'Add the Shots MCP server as a connector in Claude, then approve it here.',
      status: agentStatus('claude'),
    },
    {
      action: { href: '/workspace/ai-agents', label: 'Set up' },
      authorization: 'OAuth consent by a workspace owner or admin.',
      name: 'ChatGPT',
      purpose: 'The same Shots tools from ChatGPT connectors.',
      scopes: 'The scopes you approve at consent.',
      setup: 'Add the Shots MCP server as a ChatGPT connector, then approve it here.',
      status: agentStatus('chatgpt'),
    },
    {
      action: { href: '/workspace/ai-agents', label: 'Show the server URL' },
      authorization: 'OAuth, or a workspace API key in the X-API-Key header.',
      name: 'MCP',
      purpose:
        'Any agent that speaks the Model Context Protocol: Cursor, VS Code, Windsurf, Gemini CLI, Codex and more.',
      scopes: 'Each tool needs one API key scope; the key decides what the agent can do.',
      setup: 'Copy the MCP server URL into your client.',
      status: agentClients.length > 0 ? 'connected' : 'available',
    },
    {
      action: {
        external: true,
        href: 'https://github.com/PlaybookMediaLLC/screenshot-studio/tree/main/integrations/claude-code/shots',
        label: 'View the plugin',
      },
      authorization: 'The MCP connection above; the skill adds no access of its own.',
      name: 'Agent Skills',
      purpose: 'A Claude Code plugin with the Shots MCP server and a launch workflow skill.',
      scopes: 'Those of the MCP connection.',
      setup:
        'In Claude Code: /plugin marketplace add PlaybookMediaLLC/screenshot-studio, then /plugin install shots@shots.',
      status: 'available',
    },
    {
      authorization: 'None today.',
      name: 'Notion Agents',
      purpose:
        "There is no Shots integration for Notion's agents. The Notion integration below delivers published designs to a Notion page.",
      scopes: '—',
      setup: 'Connect Notion below to deliver designs.',
      status: 'not_available',
    },
    {
      action: { href: '/workspace/notifications', label: 'Notification settings' },
      authorization: 'A Slack app install by a workspace owner or admin.',
      name: 'Slack',
      purpose: 'Activity notifications in a channel, and published designs delivered to Slack.',
      scopes:
        'chat:write, channels:read, groups:read, files:write, channels:join. Direct messages are not supported: the app does not ask for im:write.',
      setup: missing('SLACK')
        ? 'The server needs its Slack app credentials first.'
        : 'Connect from Notifications or below.',
      status: connected('SLACK') ? 'connected' : missing('SLACK') ? 'not_configured' : 'available',
    },
    {
      action: { href: '/workspace/developers', label: 'Create a webhook' },
      authorization: 'A webhook URL from Zapier, and an API key for actions.',
      name: 'Zapier',
      purpose:
        'There is no Shots app in Zapier. Zapier can still receive Shots events and call the Shots API.',
      scopes: 'Webhooks deliver draft events; an API key with the scopes you pick lets a Zap act.',
      setup:
        "Point a Webhooks by Zapier Catch Hook at a Shots webhook, and use the API with Zapier's Webhooks action.",
      status: 'not_available',
    },
    {
      authorization: 'None today.',
      name: 'Raycast',
      purpose: 'There is no Shots extension for Raycast.',
      scopes: '—',
      setup: 'Not available.',
      status: 'not_available',
    },
  ]

  return (
    <Section
      description="What each integration does, what it needs, and whether it works here today."
      title="Agents and integrations"
    >
      {integrations.isError ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {settingsErrorMessage(integrations.error)}
        </p>
      ) : null}
      <Group>
        {entries.map((entry) => {
          const status = STATUS_LABELS[entry.status]
          return (
            <Row
              description={
                <span className="grid gap-1">
                  <span>{entry.purpose}</span>
                  <span>
                    <strong className="font-medium text-foreground/80">Access:</strong>{' '}
                    {entry.authorization}
                  </span>
                  <span>
                    <strong className="font-medium text-foreground/80">Scopes:</strong>{' '}
                    {entry.scopes}
                  </span>
                  <span>
                    <strong className="font-medium text-foreground/80">Setup:</strong> {entry.setup}
                  </span>
                </span>
              }
              key={entry.name}
              label={
                <span className="flex items-center gap-2">
                  {entry.name}
                  <Pill tone={status.tone}>{status.label}</Pill>
                </span>
              }
            >
              {entry.action ? (
                entry.action.external ? (
                  <a
                    className="text-sm underline"
                    href={entry.action.href}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {entry.action.label}
                  </a>
                ) : (
                  <Link className="text-sm underline" href={entry.action.href}>
                    {entry.action.label}
                  </Link>
                )
              ) : null}
            </Row>
          )
        })}
      </Group>
    </Section>
  )
}
