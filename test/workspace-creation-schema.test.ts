import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceCreateSchema } from '../lib/workspace/input-schemas'
import { workspaceCreationInputSchema } from '../packages/screenshot-studio-backend-sdk/src/workspace-creation'

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
