import assert from 'node:assert/strict'
import test from 'node:test'
import { assetListQuerySchema } from '@/lib/tenant/schemas'

test('listing defaults to a bounded page', () => {
  const parsed = assetListQuerySchema.parse({})

  // An unbounded list would grow with the workspace and eventually time
  // out the request that renders the gallery.
  assert.equal(parsed.limit, 50)
  assert.equal(parsed.cursor, undefined)
})

test('the page size is capped', () => {
  assert.equal(assetListQuerySchema.safeParse({ limit: 100 }).success, true)
  assert.equal(assetListQuerySchema.safeParse({ limit: 101 }).success, false)
  assert.equal(assetListQuerySchema.safeParse({ limit: 0 }).success, false)
})

test('cursors are bounded opaque keysets and filters have safe defaults', () => {
  assert.deepEqual(assetListQuerySchema.parse({}), { limit: 50, type: 'all', sort: 'newest' })
  assert.equal(assetListQuerySchema.safeParse({ cursor: 'v1.eyJpZCI6ImEifQ' }).success, true)
  for (const cursor of ['', 'not-a-cursor', 'v1.', 'v1.' + 'a'.repeat(512)]) {
    assert.equal(assetListQuerySchema.safeParse({ cursor }).success, false)
  }
  assert.equal(assetListQuerySchema.safeParse({ type: 'video', sort: 'oldest' }).success, true)
  assert.equal(assetListQuerySchema.safeParse({ type: 'audio' }).success, false)
  assert.equal(assetListQuerySchema.safeParse({ sort: 'random' }).success, false)
})
