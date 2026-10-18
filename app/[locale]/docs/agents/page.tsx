import { Metadata } from 'next'
import Link from 'next/link'
import { Footer } from '@/components/landing/Footer'
import { Navigation } from '@/components/landing/Navigation'
import { API_KEY_PLACEHOLDER, MCP_CLIENTS, MCP_TOOLS, MCP_URL } from '@/lib/agents/mcp-clients'
import { apiKeyScopeDescriptions, apiKeyScopes } from '@/lib/auth/api-key-scopes'
import { INTER, codeBlockClassName, linkClassName } from '@/lib/seo/docs-shared'
import { OG_DEFAULTS } from '@/lib/seo/metadata'

export const metadata: Metadata = {
  alternates: { canonical: '/docs/agents' },
  description:
    'Connect Claude Code, Claude.ai, ChatGPT, Cursor, VS Code, Windsurf, Gemini CLI, Codex CLI, and OpenCode to a Shots workspace through the Shots MCP server.',
  openGraph: {
    ...OG_DEFAULTS,
    description: 'Set up the Shots MCP server in your AI agent with a workspace API key or OAuth.',
    title: 'Connect AI agents to Shots',
    url: '/docs/agents',
  },
  title: 'Connect AI agents to Shots',
}

const heading = 'mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground'

/** The public setup guide for every supported agent client (RFC 037). */
export default function AgentsDocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navigation />
      <main className="mx-auto max-w-3xl flex-1 px-6 pt-28 pb-16 sm:pb-24">
        <h1
          className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl"
          style={{ fontFamily: INTER }}
        >
          Connect AI agents to Shots
        </h1>
        <p className="mb-6 text-lg leading-relaxed text-muted-foreground">
          The Shots MCP server gives an AI agent the same workspace operations as the{' '}
          <Link className={linkClassName} href="/api-reference">
            REST API
          </Link>
          : read releases and campaigns, draft campaigns, upload assets, capture screenshots, and
          submit drafts for review. A key with post:schedule also schedules posts a person approved.
          Only a person approves, in Shots; no agent can.
        </p>
        <pre className={codeBlockClassName}>
          <code>{MCP_URL}</code>
        </pre>

        <div className="mt-12 space-y-12">
          <section id="authentication">
            <h2 className={heading} style={{ fontFamily: INTER }}>
              Authentication
            </h2>
            <p className="mb-4 leading-relaxed text-muted-foreground">
              Every call acts for one workspace. Agents that take a header send a workspace API key
              as <code>Authorization: Bearer ss_…</code>; create one in Settings → AI agents with
              only the scopes the agent needs. Claude.ai, Claude Desktop, and ChatGPT connect
              through OAuth instead: you sign in to Shots, choose the scopes, and approve. The token
              they receive is a workspace API key with exactly those scopes, listed and revocable in
              Settings.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium text-foreground">Scope</th>
                    <th className="py-2 font-medium text-foreground">Lets the agent</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeyScopes.map((scope) => (
                    <tr className="border-b border-border/60" key={scope}>
                      <td className="py-2 pr-4 font-mono text-xs text-foreground">{scope}</td>
                      <td className="py-2 text-muted-foreground">
                        {apiKeyScopeDescriptions[scope]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Calls pass the same checks as the API: the key&apos;s scope, an active plan, the
              operation&apos;s feature, and its quota. Each key may make 60 calls a minute. Refusals
              use the{' '}
              <Link className={linkClassName} href="/api-reference#errors">
                API error envelope
              </Link>
              .
            </p>
          </section>

          <section id="tools">
            <h2 className={heading} style={{ fontFamily: INTER }}>
              Tools
            </h2>
            <p className="mb-4 leading-relaxed text-muted-foreground">
              Each tool is named after the API operation it mirrors and takes the same input. An
              agent sees only the tools its key&apos;s scopes allow.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium text-foreground">Tool</th>
                    <th className="py-2 pr-4 font-medium text-foreground">Scope</th>
                    <th className="py-2 font-medium text-foreground">Does</th>
                  </tr>
                </thead>
                <tbody>
                  {MCP_TOOLS.map((tool) => (
                    <tr className="border-b border-border/60" key={tool.name}>
                      <td className="py-2 pr-4 font-mono text-xs text-foreground">{tool.name}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                        {tool.scope}
                      </td>
                      <td className="py-2 text-muted-foreground">{tool.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {MCP_CLIENTS.map((client) => (
            <section id={client.id} key={client.id}>
              <h2 className={heading} style={{ fontFamily: INTER }}>
                {client.name}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">{client.location}</p>
              <pre className={codeBlockClassName}>
                <code>{client.snippet(MCP_URL, API_KEY_PLACEHOLDER)}</code>
              </pre>
              <ol className="mt-4 list-decimal space-y-1 pl-5 leading-relaxed text-muted-foreground">
                {client.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ))}

          <section id="reference">
            <h2 className={heading} style={{ fontFamily: INTER }}>
              Reference
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                <Link className={linkClassName} href="/openapi.json">
                  OpenAPI 3.1 document
                </Link>
                : the contract every tool&apos;s schema is generated from.
              </li>
              <li>
                <Link className={linkClassName} href="/api-reference">
                  Interactive API reference
                </Link>
                , with a quickstart.
              </li>
              <li>
                <Link className={linkClassName} href="/llms.txt">
                  llms.txt
                </Link>{' '}
                for agents reading the site.
              </li>
            </ul>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
