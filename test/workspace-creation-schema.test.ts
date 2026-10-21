import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceCreateSchema } from '../lib/workspace/input-schemas'
import {
  workspaceCreationInputSchema,
  workspaceCreationMetadataSchema,
  workspaceCreationLogoSchema,
} from '../packages/screenshot-studio-backend-sdk/src/workspace-creation'

test('creation preserves retry identity and optional active-workspace preservation', () => {
  const input = {
    name: 'Team',
    slug: 'team',
    idempotencyKey: 'c070e1ef-a7c8-4f48-b582-e84d5e831e4c',
    keepCurrentActiveOrganization: true,
  }
  assert.deepEqual(workspaceCreateSchema.parse(input), input)
  assert.deepEqual(workspaceCreationInputSchema.parse(input), input)
  for (const schema of [workspaceCreateSchema, workspaceCreationInputSchema]) {
    assert.equal(schema.safeParse({ ...input, idempotencyKey: 'bad' }).success, false)
    assert.equal(
      schema.safeParse({ ...input, keepCurrentActiveOrganization: 'true' }).success,
      false
    )
    assert.equal(schema.safeParse({ name: 'Team', slug: 'team' }).success, true)
  }
})

test('creation metadata is bounded and logo references contain no credentials', () => {
  assert.equal(
    workspaceCreationMetadataSchema.safeParse({
      source: 'test',
      nested: { count: 2, enabled: true },
    }).success,
    true
  )
  for (const value of [
    { large: 'x'.repeat(8193) },
    { escaped: '<'.repeat(1500) },
    { nested: { nested: { nested: {} } } },
  ]) {
    assert.equal(workspaceCreationMetadataSchema.safeParse(value).success, false)
  }
  assert.equal(workspaceCreationLogoSchema.safeParse('https://example.test/logo.png').success, true)
  for (const value of [
    'file:///tmp/logo.png',
    'https://user:password@example.test/logo.png',
    'https://example.test/' + 'x'.repeat(2048),
  ]) {
    assert.equal(workspaceCreationLogoSchema.safeParse(value).success, false)
  }
})
