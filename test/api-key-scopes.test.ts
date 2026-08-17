import assert from 'node:assert/strict'
import test from 'node:test'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'

test('organization API keys expose only intake and artifact scopes', () => {
  assert.deepEqual(apiKeyScopes, [
    'artifact:read',
    'asset:write',
    'release:create',
    'source:write',
    'upload:sign',
  ])
})
