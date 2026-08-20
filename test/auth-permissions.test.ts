import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPermission, normalizeOrganizationRole } from '@/lib/auth/permissions'

test('fixed roles enforce least-privilege permissions', () => {
  assert.equal(hasPermission('creator', 'release:create'), true)
  assert.equal(hasPermission('creator', 'publish:manage'), false)
  assert.equal(hasPermission('publisher', 'publish:manage'), true)
  assert.equal(hasPermission('viewer', 'audit:read'), false)
  assert.equal(hasPermission('admin', 'member:invite'), true)
  assert.equal(hasPermission('admin', 'workspace:delete'), false)
  assert.equal(hasPermission('owner', 'workspace:transfer_ownership'), true)
})

test('legacy Better Auth member role remains viewer-equivalent', () => {
  assert.equal(normalizeOrganizationRole('member'), 'viewer')
  assert.equal(normalizeOrganizationRole('unexpected-role'), 'viewer')
})
