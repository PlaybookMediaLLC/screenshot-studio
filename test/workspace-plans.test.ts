import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateWorkspaceFeature, getMinimumPlan, hasWorkspaceFeature } from '@/lib/billing/plans'

test('free workspaces cannot delete assets', () => {
  assert.equal(hasWorkspaceFeature('free', 'asset:delete'), false)
  assert.equal(getMinimumPlan('asset:delete'), 'pro')
})

test('paid workspaces can delete assets', () => {
  assert.equal(hasWorkspaceFeature('pro', 'asset:delete'), true)
  assert.equal(hasWorkspaceFeature('business', 'asset:delete'), true)
  assert.equal(hasWorkspaceFeature('enterprise', 'asset:delete'), true)
})

test('resource update paths can use the same named feature gate', () => {
  assert.equal(hasWorkspaceFeature('free', 'asset:update'), false)
  assert.equal(hasWorkspaceFeature('pro', 'asset:update'), true)
  assert.equal(getMinimumPlan('asset:update'), 'pro')
})

test('enterprise-only features remain unavailable to lower plans', () => {
  assert.equal(hasWorkspaceFeature('business', 'enterprise:sso'), false)
  assert.equal(hasWorkspaceFeature('enterprise', 'enterprise:sso'), true)
})

test('contract overrides can grant or revoke one feature without changing plans', () => {
  assert.equal(hasWorkspaceFeature('free', 'asset:delete', { 'asset:delete': true }), true)
  assert.equal(
    hasWorkspaceFeature('enterprise', 'enterprise:scim', { 'enterprise:scim': false }),
    false
  )
})

test('expired and suspended plans fail closed before feature execution', () => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  assert.equal(
    evaluateWorkspaceFeature(
      { plan: 'enterprise', status: 'active', validUntil: new Date('2026-08-26T11:59:59Z') },
      'enterprise:sso',
      now
    ).allowed,
    false
  )
  assert.equal(
    evaluateWorkspaceFeature({ plan: 'enterprise', status: 'suspended' }, 'enterprise:sso', now)
      .allowed,
    false
  )
})

test('unknown plans and malformed overrides fall back to free-plan policy', () => {
  const decision = evaluateWorkspaceFeature(
    { featureOverrides: { unknown: true }, plan: 'untrusted-tier', status: 'active' },
    'asset:delete'
  )
  assert.deepEqual(decision, {
    allowed: false,
    currentPlan: 'free',
    requiredPlan: 'pro',
  })
})
