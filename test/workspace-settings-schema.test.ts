import assert from 'node:assert/strict'
import test from 'node:test'
import {
  workspaceApiKeySchema,
  workspaceUpdateSchema,
} from '../lib/tenant/workspace-settings-schema'

test('workspace settings reject unsafe slugs and unscoped API keys', () => {
  assert.equal(workspaceUpdateSchema.safeParse({ name: 'Acme', slug: 'acme-studio' }).success, true)
  assert.equal(
    workspaceUpdateSchema.safeParse({ name: 'Acme', slug: 'Acme Studio' }).success,
    false
  )
  assert.equal(workspaceApiKeySchema.safeParse({ name: 'Release bot', scopes: [] }).success, false)
  assert.equal(
    workspaceApiKeySchema.safeParse({
      expiresInDays: 30,
      name: 'Release bot',
      scopes: ['release:create', 'upload:sign'],
    }).success,
    true
  )
})
