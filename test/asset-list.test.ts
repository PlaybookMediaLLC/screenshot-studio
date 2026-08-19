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

test('a cursor must be an asset identifier', () => {
  // The cursor is echoed back into a where clause, so a value that is not
  // an asset id is rejected at the boundary rather than reaching the
  // query.
  assert.equal(
    assetListQuerySchema.safeParse({ cursor: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).success,
    true
  )
  assert.equal(assetListQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success, false)
  assert.equal(assetListQuerySchema.safeParse({ cursor: '' }).success, false)
})
