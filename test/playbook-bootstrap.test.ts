import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlaybookBootstrap } from '@/lib/core/bootstrap-shape'

const capabilities = {
  browserAutomation: false,
  engineeringAgent: false,
  publishing: true,
  voiceCapture: false,
  workflows: false,
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    capabilities,
    counters: { approvals: 2, attention: 1 },
    entitlements: { features: { 'asset:read': true }, plan: 'pro', status: 'active' },
    organization: { id: 'org-1', logo: null, name: 'Acme', slug: 'acme' },
    organizations: [
      { id: 'org-1', name: 'Acme', role: 'owner', slug: 'acme' },
      { id: 'org-2', name: 'Beta', role: 'member', slug: 'beta' },
    ],
    role: 'creator',
    settings: { defaultPublishTime: '10:30', locale: 'fr', timeZone: 'Europe/Paris' },
    user: { email: 'founder@example.test', id: 'user-1', name: 'Founder' },
    ...overrides,
  }
}

test('bootstrap resolves role permissions and normalizes legacy roles', () => {
  const bootstrap = buildPlaybookBootstrap(source())
  assert.equal(bootstrap.membership.role, 'creator')
  assert.ok(bootstrap.membership.permissions.includes('release:create'))
  assert.ok(!bootstrap.membership.permissions.includes('member:invite'))
  assert.deepEqual(
    bootstrap.organizations.map((organization) => organization.role),
    ['owner', 'viewer']
  )
  assert.deepEqual(bootstrap.workspace, {
    defaultPublishTime: '10:30',
    locale: 'fr',
    timeZone: 'Europe/Paris',
  })
})

test('bootstrap falls back to workspace defaults when settings are missing', () => {
  assert.deepEqual(buildPlaybookBootstrap(source({ settings: null })).workspace, {
    defaultPublishTime: '09:00',
    locale: 'en',
    timeZone: 'UTC',
  })
})

test('bootstrap never copies credentials or provider ids from its sources', () => {
  const leaky = source({
    entitlements: {
      externalCustomerId: 'cus_secret',
      externalSubscriptionId: 'sub_secret',
      features: { 'asset:read': true },
      plan: 'pro',
      status: 'active',
    },
    organization: { id: 'org-1', logo: null, metadata: 'internal', name: 'Acme', slug: 'acme' },
    organizations: [{ id: 'org-1', name: 'Acme', role: 'owner', secretReference: 'X', slug: 'a' }],
    user: { email: 'f@example.test', id: 'user-1', name: null, password: 'hunter2', token: 't' },
  })
  const serialized = JSON.stringify(buildPlaybookBootstrap(leaky))
  for (const secret of ['cus_secret', 'sub_secret', 'internal', 'secretReference', 'hunter2']) {
    assert.ok(!serialized.includes(secret), `bootstrap leaked ${secret}`)
  }
  assert.ok(!serialized.includes('"token"'))
})
