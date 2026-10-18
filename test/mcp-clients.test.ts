import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { API_KEY_PLACEHOLDER, MCP_CLIENTS, MCP_TOOLS } from '@/lib/agents/mcp-clients'
import { openApiSpec } from '@/lib/api/openapi'

const url = 'https://api.shots.test/mcp'

test('every client snippet is a valid configuration that points at the Go MCP server', () => {
  for (const client of MCP_CLIENTS) {
    for (const key of [API_KEY_PLACEHOLDER, 'ss_live_key']) {
      const snippet = client.snippet(url, key)
      assert.match(
        snippet,
        /https:\/\/api\.shots\.test\/mcp(-oauth-(claude|chatgpt|dynamic))?/,
        client.id
      )
      if (client.language === 'json') assert.doesNotThrow(() => JSON.parse(snippet), client.id)
      if (client.auth === 'oauth') {
        assert.doesNotMatch(snippet, /ss_live_key/, `${client.id} must not embed a key`)
        continue
      }
      if (key === API_KEY_PLACEHOLDER) {
        assert.doesNotMatch(snippet, /ss_live_key/, client.id)
      } else {
        assert.match(snippet, /Bearer ss_live_key/, `${client.id} must use the created key`)
      }
    }
    assert.ok(client.steps.length > 0, client.id)
  }
  assert.deepEqual(
    MCP_CLIENTS.map((client) => client.id),
    [
      'claude-code',
      'claude',
      'chatgpt',
      'cursor',
      'vscode',
      'windsurf',
      'gemini-cli',
      'codex',
      'opencode',
    ]
  )
})

test('the documented tools are the Go tool table, with the scopes the spec declares', () => {
  const source = readFileSync('services/internal/social/chat/mcp/tools.go', 'utf8')
  const goTools = [...source.matchAll(/^\t\{"(\w+)", \w+,/gm)].map((match) => match[1])
  assert.deepEqual(
    MCP_TOOLS.map((tool) => tool.name),
    goTools
  )
  const operations = Object.values(openApiSpec.paths).flatMap((item) =>
    Object.values(
      item as Record<string, { operationId?: string; security?: Record<string, string[]>[] }>
    )
  )
  for (const tool of MCP_TOOLS) {
    const operation = operations.find((candidate) => candidate.operationId === tool.name)
    const scopes = operation?.security?.flatMap((requirement) => requirement.workspaceApiKey ?? [])
    assert.deepEqual(scopes, [tool.scope], tool.name)
  }
})
