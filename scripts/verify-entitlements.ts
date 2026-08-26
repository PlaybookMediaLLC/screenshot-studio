import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { syncWorkspaceEntitlement, EntitlementSyncError } from '@/lib/billing/entitlements'

async function main(): Promise<void> {
  assert.equal(
    process.env.ENTITLEMENT_TEST_ALLOW_DATABASE,
    'true',
    'Set ENTITLEMENT_TEST_ALLOW_DATABASE=true only for a disposable PlanetScale development branch.'
  )

  const suffix = randomUUID()
  const organizationId = `entitlement-test-${suffix}`

  try {
    await prisma.organization.create({
      data: {
        createdAt: new Date(),
        id: organizationId,
        name: `Entitlement test ${suffix}`,
        slug: `entitlement-test-${suffix}`,
      },
    })

    const event = {
      eventId: `event-${suffix}`,
      eventType: 'subscription.updated',
      expectedVersion: 0,
      externalCustomerId: `customer-${suffix}`,
      externalSubscriptionId: `subscription-${suffix}`,
      featureOverrides: { 'asset:delete': true },
      organizationId,
      plan: 'enterprise' as const,
      provider: 'verification',
      status: 'active' as const,
    }
    assert.deepEqual(await syncWorkspaceEntitlement(event), { replayed: false, version: 1 })
    assert.deepEqual(await syncWorkspaceEntitlement(event), { replayed: true, version: 1 })

    await assert.rejects(
      syncWorkspaceEntitlement({ ...event, eventId: `conflict-${suffix}`, expectedVersion: 0 }),
      (error: unknown) => error instanceof EntitlementSyncError && error.status === 409
    )
    const entitlement = await prisma.workspaceEntitlement.findUniqueOrThrow({
      where: { organizationId },
    })
    assert.equal(entitlement.version, 1)
    assert.equal(entitlement.plan, 'enterprise')
    assert.equal(
      await prisma.auditLog.count({
        where: { action: 'billing.entitlement_changed', organizationId },
      }),
      1
    )
    process.stdout.write(
      'Verified entitlement sync, replay safety, auditing, and optimistic concurrency.\n'
    )
  } finally {
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { organizationId } }),
      prisma.billingEntitlementEvent.deleteMany({ where: { organizationId } }),
      prisma.workspaceEntitlement.deleteMany({ where: { organizationId } }),
      prisma.organization.deleteMany({ where: { id: organizationId } }),
    ])
    await prisma.$disconnect()
  }
}

void main()
