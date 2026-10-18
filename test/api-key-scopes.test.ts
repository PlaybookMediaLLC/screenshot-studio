import assert from 'node:assert/strict'
import test from 'node:test'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'

// Drafts are content, not publishing: drafts are scheduled by a session only
// (RFC 037). post:schedule schedules approved campaign content (RFC 038).
test('organization API keys expose only intake, artifact, draft, and scheduling scopes', () => {
  assert.deepEqual(apiKeyScopes, [
    'artifact:read',
    'asset:write',
    'draft:write',
    'post:schedule',
    'release:create',
    'source:write',
    'upload:sign',
  ])
})
