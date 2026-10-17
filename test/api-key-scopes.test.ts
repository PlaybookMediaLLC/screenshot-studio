import assert from 'node:assert/strict'
import test from 'node:test'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'

// Drafts are content, not publishing: scheduling stays session-only (RFC 037).
test('organization API keys expose only intake, artifact, draft, and onboarding scopes', () => {
  assert.deepEqual(apiKeyScopes, [
    'artifact:read',
    'asset:write',
    'draft:write',
    'onboarding:run',
    'release:create',
    'source:write',
    'upload:sign',
  ])
})
