import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  automationActionSchema,
  automationActionTypeSchema,
  automationGraphSchema,
} from '../lib/api/contracts/release-automation'
import {
  automationHistoryFilterSchema,
  automationSourceModeSchema,
} from '../lib/api/contracts/workflow-runs'
import { producersOf, requiredSchemaVersion, WORKFLOW_ACTIONS } from '../lib/workflows/actions'
import { buildWorkflowTemplate, workflowTemplateIdSchema } from '../lib/workflows/templates'

// The Go validator reads the same file in services/internal/releaseautomation,
// so a template that drifts from the executor's language fails on both sides.
const fixture = JSON.parse(
  readFileSync('services/internal/releaseautomation/testdata/workflow-templates.json', 'utf8')
)

test('templates build the shared fixture graphs the Go validator accepts', () => {
  for (const id of workflowTemplateIdSchema.options) {
    for (const creditLimit of [0, 40]) {
      const { graph, layout } = buildWorkflowTemplate(id, {
        brandKitId: 'brand-fixture',
        destinationIds: ['destination-fixture'],
        creditLimit,
        branch: 'main',
      })
      assert.deepEqual(graph, fixture[`${id}${creditLimit ? '+copy' : ''}`])
      assert.deepEqual(automationGraphSchema.parse(graph), graph)
      assert.equal(graph.schemaVersion, requiredSchemaVersion(graph))
      assert.deepEqual(Object.keys(layout).sort(), graph.nodes.map((node) => node.id).sort())
    }
  }
})

test('the action registry covers every executor action and wires outputs to inputs', () => {
  assert.deepEqual(
    Object.keys(WORKFLOW_ACTIONS).sort(),
    [...automationActionTypeSchema.options].sort()
  )
  assert.deepEqual(producersOf('submit_review'), ['create_campaign', 'generate_copy'])
  assert.deepEqual(producersOf('create_campaign'), ['create_release'])
  assert.deepEqual(producersOf('create_release'), [])
  for (const spec of Object.values(WORKFLOW_ACTIONS)) {
    assert.equal(spec.paid, spec.type === 'generate_copy')
    assert.equal(spec.humanApproval, spec.type === 'submit_review')
  }
})

test('action configurations are a discriminated union with no publishing or approval action', () => {
  assert.ok(automationActionSchema.safeParse({ type: 'generate_copy', creditLimit: 40 }).success)
  assert.ok(automationActionSchema.safeParse({ type: 'create_campaign' }).success)
  for (const type of ['publish', 'approve', 'schedule', 'notify']) {
    assert.equal(automationActionSchema.safeParse({ type }).success, false, type)
  }
  assert.equal(
    automationActionSchema.safeParse({ type: 'generate_copy', creditLimit: 501 }).success,
    false
  )
})

test('run filters and source modes reject unknown or unsafe values', () => {
  assert.ok(automationHistoryFilterSchema.safeParse({ status: 'needs_attention' }).success)
  for (const invalid of [
    { status: 'approved' },
    { organizationId: 'other' },
    { since: 'yesterday' },
  ]) {
    assert.equal(automationHistoryFilterSchema.safeParse(invalid).success, false)
  }
  assert.ok(
    automationSourceModeSchema.safeParse({ id: 's', enabled: true, branch: 'release/2026' }).success
  )
  for (const branch of ['bad..name', '-flag', 'has space', 'a:b']) {
    assert.equal(
      automationSourceModeSchema.safeParse({ id: 's', enabled: true, branch }).success,
      false,
      branch
    )
  }
})
