import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesWorkspaceScope, workspaceScopeHeaders } from '../lib/auth/request-scope'

test('browser expectations cannot follow a different workspace or signed-in person', () => {
  const displayed = { userId: 'person-a', workspaceId: 'workspace-a' }
  const headers = new Headers(workspaceScopeHeaders(displayed))
  assert.equal(matchesWorkspaceScope(headers, displayed), true)
  assert.equal(matchesWorkspaceScope(headers, { ...displayed, workspaceId: 'workspace-b' }), false)
  assert.equal(matchesWorkspaceScope(headers, { ...displayed, userId: 'person-b' }), false)
  headers.delete('x-playbook-user')
  assert.equal(matchesWorkspaceScope(headers, displayed), false)
  headers.set('x-playbook-user', '')
  assert.equal(matchesWorkspaceScope(headers, displayed), false)
  assert.equal(matchesWorkspaceScope(new Headers(), displayed), true)
})
