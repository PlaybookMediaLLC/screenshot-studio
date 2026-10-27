import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTenantObjectKey, buildTenantObjectKey } from '@/lib/tenant/object-key'

test('tenant object keys are server-built and organization-scoped', () => {
  const key = buildTenantObjectKey({
    assetId: 'asset_1',
    classification: 'input',
    fileName: 'launch.png',
    organizationId: 'org_a',
    revision: 2,
  })
  assert.equal(key, 'org/org_a/input/asset_1/2/launch.png')
  assert.doesNotThrow(() => assertTenantObjectKey('org_a', key))
  assert.throws(() => assertTenantObjectKey('org_b', key))
})

test('tenant object keys reject unsafe path segments', () => {
  assert.throws(() =>
    buildTenantObjectKey({
      assetId: 'asset_1',
      classification: 'input',
      fileName: '../launch.png',
      organizationId: 'org_a',
      revision: 1,
    })
  )
})
