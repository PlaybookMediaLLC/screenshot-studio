import assert from 'node:assert/strict'
import test from 'node:test'
import {
  campaignCreateSchema,
  productSurfaceUpdateSchema,
  releaseCreateSchema,
  releaseUpdateSchema,
} from '@/lib/tenant/schemas'

const release = { benefitStatement: 'Invoices send themselves.', title: 'Recurring invoices' }

test('release briefs reject markup and non-web source links', () => {
  assert.equal(releaseCreateSchema.safeParse(release).success, true)
  assert.equal(
    releaseCreateSchema.safeParse({ ...release, description: 'Use <script>alert(1)</script>' })
      .success,
    false
  )
  assert.equal(
    releaseCreateSchema.safeParse({ ...release, description: 'Faster: 2 < 3 and 5 > 4' }).success,
    true
  )
  assert.equal(
    releaseCreateSchema.safeParse({ ...release, sourceUrls: ['javascript:alert(1)'] }).success,
    false
  )
  assert.equal(
    releaseCreateSchema.safeParse({ ...release, sourceUrls: ['https://example.com/changelog'] })
      .success,
    true
  )
})

test('draft campaigns accept no angles or posts and optional release context', () => {
  const parsed = campaignCreateSchema.parse({ name: 'Launch', objective: 'Announce' })
  assert.deepEqual(parsed.angles, [])
  assert.deepEqual(parsed.posts, [])
  assert.equal(
    campaignCreateSchema.safeParse({ name: 'L', objective: 'A', releaseId: 'not-a-uuid' }).success,
    false
  )
})

test('partial updates do not reset omitted fields to their create defaults', () => {
  assert.deepEqual(productSurfaceUpdateSchema.parse({ name: 'Renamed' }), { name: 'Renamed' })
  assert.deepEqual(releaseUpdateSchema.parse({ title: 'Renamed' }), { title: 'Renamed' })
  assert.deepEqual(releaseUpdateSchema.parse({ description: null }), { description: null })
})
