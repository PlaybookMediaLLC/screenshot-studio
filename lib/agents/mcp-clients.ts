/**
 * How each AI agent client connects to the Shots MCP server (RFC 037). One
 * source for the public guide at /docs/agents, Settings → AI agents, and
 * llms-full.txt, so a snippet is never copied by hand into three places.
 */

/** The public MCP endpoint for this deployment: the Go backend, never Next.js. */
export const MCP_URL = process.env.PLATFORM_MCP_URL ?? 'https://api.shots.playbookmedia.io/mcp'

/** The MCP base without `/mcp`, where the OAuth mounts live. */
export const MCP_BASE_URL = MCP_URL.replace(/\/mcp\/?$/, '')

/** The placeholder a snippet shows until a key is created on the page. */
export const API_KEY_PLACEHOLDER = '$SHOTS_API_KEY'

/** How a client authenticates. */
export type McpClientAuth = 'api-key' | 'oauth' | 'api-key-or-oauth'

/** One agent client's setup. */
export interface McpClientGuide {
  id: string
  name: string
  auth: McpClientAuth
  /** Where the snippet goes: a command, or the config file it belongs in. */
  location: string
  /** Steps after the snippet. */
  steps: string[]
  /** The copy-paste configuration for `mcpUrl` and an API key (or its placeholder). */
  snippet: (mcpUrl: string, apiKey: string) => string
  /** The language of the snippet, for display. */
  language: 'bash' | 'json' | 'toml' | 'text'
}

function mount(mcpUrl: string, path: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, path)
}

/** A literal key goes in quotes; the placeholder stays an environment reference. */
function bearer(apiKey: string, reference: string): string {
  return apiKey === API_KEY_PLACEHOLDER ? `Bearer ${reference}` : `Bearer ${apiKey}`
}

/** Every supported client, in the order the guide lists them. */
export const MCP_CLIENTS: McpClientGuide[] = [
  {
    auth: 'api-key-or-oauth',
    id: 'claude-code',
    language: 'bash',
    location: 'Terminal',
    name: 'Claude Code',
    snippet: (mcpUrl, apiKey) =>
      `claude mcp add --transport http shots ${mcpUrl} \\\n  --header "Authorization: ${bearer(apiKey, '$SHOTS_API_KEY')}"`,
    steps: [
      'Run the command, then /mcp in Claude Code to check that shots is connected.',
      'Without the --header line, Claude Code connects through OAuth: run /mcp, pick shots, and approve it in your browser.',
      'Or install the Shots plugin, which adds the server (over OAuth) and a launch skill: /plugin install shots --marketplace PlaybookMediaLLC/screenshot-studio.',
    ],
  },
  {
    auth: 'oauth',
    id: 'claude',
    language: 'text',
    location: 'Claude.ai or Claude Desktop → Settings → Connectors → Add custom connector',
    name: 'Claude.ai and Claude Desktop',
    snippet: (mcpUrl) => mount(mcpUrl, '/mcp-oauth-claude'),
    steps: [
      'Name the connector Shots and paste the URL.',
      'Select Connect and sign in to Shots. Pick the scopes the connector may use, then approve.',
      'Claude Desktop uses the same connectors as Claude.ai once you are signed in.',
    ],
  },
  {
    auth: 'oauth',
    id: 'chatgpt',
    language: 'text',
    location: 'ChatGPT → Settings → Apps & Connectors → Advanced → Developer mode → Create',
    name: 'ChatGPT',
    snippet: (mcpUrl) => mount(mcpUrl, '/mcp-oauth-dynamic'),
    steps: [
      'Name the connector Shots, paste the URL, and choose OAuth.',
      'Sign in to Shots when ChatGPT opens it, pick the scopes, and approve.',
      'The listed Shots app in the ChatGPT directory connects through /mcp-oauth-chatgpt with its registered client; a developer-mode connector registers itself through the URL above.',
    ],
  },
  {
    auth: 'api-key-or-oauth',
    id: 'cursor',
    language: 'json',
    location: '~/.cursor/mcp.json, or .cursor/mcp.json in a project',
    name: 'Cursor',
    snippet: (mcpUrl, apiKey) =>
      JSON.stringify(
        {
          mcpServers: {
            shots: {
              headers: { Authorization: bearer(apiKey, '${env:SHOTS_API_KEY}') },
              url: mcpUrl,
            },
          },
        },
        null,
        2
      ),
    steps: [
      'Save the file and open Cursor Settings → MCP to see shots connected.',
      'Leave out headers to connect through OAuth instead; Cursor opens Shots to approve it.',
    ],
  },
  {
    auth: 'api-key-or-oauth',
    id: 'vscode',
    language: 'json',
    location: '.vscode/mcp.json in a workspace, or MCP: Open User Configuration',
    name: 'VS Code (GitHub Copilot)',
    snippet: (mcpUrl, apiKey) =>
      JSON.stringify(
        {
          inputs:
            apiKey === API_KEY_PLACEHOLDER
              ? [
                  {
                    description: 'Shots API key',
                    id: 'shots-api-key',
                    password: true,
                    type: 'promptString',
                  },
                ]
              : [],
          servers: {
            shots: {
              headers: { Authorization: bearer(apiKey, '${input:shots-api-key}') },
              type: 'http',
              url: mcpUrl,
            },
          },
        },
        null,
        2
      ),
    steps: [
      'Save the file, then select Start above the shots entry. VS Code asks for the key once and stores it securely.',
      'Use the tools from Copilot Chat in agent mode.',
    ],
  },
  {
    auth: 'api-key',
    id: 'windsurf',
    language: 'json',
    location: '~/.codeium/windsurf/mcp_config.json',
    name: 'Windsurf',
    snippet: (mcpUrl, apiKey) =>
      JSON.stringify(
        {
          mcpServers: {
            shots: {
              headers: { Authorization: bearer(apiKey, '${env:SHOTS_API_KEY}') },
              serverUrl: mcpUrl,
            },
          },
        },
        null,
        2
      ),
    steps: ['Save the file, then refresh the MCP servers in Cascade’s plugin panel.'],
  },
  {
    auth: 'api-key-or-oauth',
    id: 'gemini-cli',
    language: 'bash',
    location: 'Terminal',
    name: 'Gemini CLI',
    snippet: (mcpUrl, apiKey) =>
      `gemini mcp add --transport http shots ${mcpUrl} \\\n  --header "Authorization: ${bearer(apiKey, '$SHOTS_API_KEY')}"`,
    steps: [
      'The command writes the server to ~/.gemini/settings.json. Run /mcp in Gemini CLI to check it.',
      'Leave out the header and run /mcp auth shots to connect through OAuth instead.',
    ],
  },
  {
    auth: 'api-key',
    id: 'codex',
    language: 'toml',
    location: '~/.codex/config.toml',
    name: 'Codex CLI',
    snippet: (mcpUrl, apiKey) =>
      apiKey === API_KEY_PLACEHOLDER
        ? `[mcp_servers.shots]\nurl = "${mcpUrl}"\nbearer_token_env_var = "SHOTS_API_KEY"`
        : `[mcp_servers.shots]\nurl = "${mcpUrl}"\nhttp_headers = { Authorization = "Bearer ${apiKey}" }`,
    steps: [
      'Export SHOTS_API_KEY in the shell Codex runs in, then run codex mcp list to check shots.',
    ],
  },
  {
    auth: 'api-key-or-oauth',
    id: 'opencode',
    language: 'json',
    location: 'opencode.json in a project, or ~/.config/opencode/opencode.json',
    name: 'OpenCode',
    snippet: (mcpUrl, apiKey) =>
      JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            shots: {
              enabled: true,
              headers: { Authorization: bearer(apiKey, '{env:SHOTS_API_KEY}') },
              type: 'remote',
              url: mcpUrl,
            },
          },
        },
        null,
        2
      ),
    steps: [
      'Run opencode mcp list to check that shots is connected.',
      'Leave out headers and run opencode mcp auth shots to connect through OAuth instead.',
    ],
  },
]

/** The tools agents get, by the scope that grants them (RFC 037). */
export const MCP_TOOLS: { name: string; scope: string; summary: string }[] = [
  { name: 'listReleases', scope: 'artifact:read', summary: 'List the workspace releases' },
  { name: 'createRelease', scope: 'release:create', summary: 'Create a release brief' },
  { name: 'createAssetUploadUrl', scope: 'upload:sign', summary: 'Sign an asset upload' },
  { name: 'completeAssetUpload', scope: 'asset:write', summary: 'Complete an asset upload' },
  { name: 'createAssetDownloadUrl', scope: 'artifact:read', summary: 'Sign an asset download' },
  { name: 'deleteAsset', scope: 'asset:write', summary: 'Delete an asset (asks to confirm)' },
  { name: 'captureScreenshot', scope: 'artifact:read', summary: 'Screenshot a public page' },
  { name: 'listCampaigns', scope: 'artifact:read', summary: 'List campaigns' },
  { name: 'getCampaign', scope: 'artifact:read', summary: 'Read a campaign and its posts' },
  { name: 'createCampaign', scope: 'release:create', summary: 'Create a draft campaign' },
  { name: 'listApprovals', scope: 'artifact:read', summary: 'List posts waiting for review' },
  { name: 'requestCampaignReview', scope: 'release:create', summary: 'Submit drafts for review' },
]
