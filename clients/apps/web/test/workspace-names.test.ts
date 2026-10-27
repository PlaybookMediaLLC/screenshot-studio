import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { z } from 'zod'
import {
  workspaceNameInputSchema,
  workspaceNameSchema,
} from '../../../packages/screenshot-studio-backend-sdk/src/workspace-names'
import { workspaceCreationInputSchema } from '../../../packages/screenshot-studio-backend-sdk/src/workspace-creation'
import { workspaceCreateSchema } from '../lib/workspace/input-schemas'
import {
  isTerminalCreationError,
  newWorkspaceCreationAttempt,
} from '../lib/workspace/creation-attempt'

const cases = z
  .array(
    z.strictObject({ label: z.string(), input: z.string(), normalized: z.string().nullable() })
  )
  .parse(JSON.parse(readFileSync(new URL('./workspace-name-cases.json', import.meta.url), 'utf8')))

for (const entry of cases) {
  test(`workspace name policy: ${entry.label}`, () => {
    const parsed = workspaceNameSchema.safeParse(entry.input)
    assert.equal(parsed.success, entry.normalized !== null)
    if (parsed.success) {
      assert.equal(parsed.data, entry.normalized)
      // Retrying a pre-normalization request preserves its original fingerprint.
      assert.equal(workspaceNameInputSchema.parse(entry.input), entry.input)
    }
    for (const schema of [workspaceCreateSchema, workspaceCreationInputSchema]) {
      const result = schema.safeParse({ name: entry.input, slug: 'test-team' })
      assert.equal(result.success, entry.normalized !== null)
      if (result.success) assert.equal(result.data.name, entry.input)
    }
  })
}

test('same display names produce independent durable creation intents', () => {
  const first = newWorkspaceCreationAttempt('東京')
  const second = newWorkspaceCreationAttempt('東京')
  assert.equal(first.input.name, second.input.name)
  assert.notEqual(first.input.idempotencyKey, second.input.idempotencyKey)
  assert.notEqual(first.input.slug, second.input.slug)
  assert.equal(first.input.keepCurrentActiveOrganization, true)
})

test('a name truncated at a word boundary still creates a valid request', () => {
  const name = `${'a'.repeat(59)} b`
  const attempt = newWorkspaceCreationAttempt(name)
  assert.equal(workspaceCreateSchema.parse(attempt.input).name, name)
})

test('creation rejection is distinct from an unknown external outcome', () => {
  for (const httpStatus of [400, 403, 409]) {
    assert.equal(isTerminalCreationError({ data: { httpStatus } }), true)
  }
  for (const httpStatus of [401, 429, 500, 502, 503]) {
    assert.equal(isTerminalCreationError({ data: { httpStatus } }), false)
  }
  assert.equal(isTerminalCreationError(new Error('connection reset')), false)
  assert.equal(isTerminalCreationError(new DOMException('Aborted', 'AbortError')), false)
})
