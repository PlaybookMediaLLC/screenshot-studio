import assert from 'node:assert/strict'
import test from 'node:test'
import { libraryQuery } from '@/lib/write/library'

test('FILTER-01: a search typed while a filter removal is in flight does not restore the filter', () => {
  let location = '?set=brand&kind=article'
  const query = libraryQuery(() => location)
  assert.deepEqual(query.change({ kind: undefined }), { navigate: true, search: 'set=brand' })
  // The address bar still shows the removed filter until the router commits.
  assert.deepEqual(query.change({ q: 'QA keyboard' }), {
    navigate: true,
    search: 'set=brand&q=QA+keyboard',
  })
  query.settle()
  location = '?set=brand&q=QA+keyboard'
  // Settled, a search alone filters the loaded drafts without a navigation.
  assert.deepEqual(query.change({ q: 'QA' }), { navigate: false, search: 'set=brand&q=QA' })
  // Back/forward commits another URL; the next change starts from it.
  query.settle()
  location = '?set=brand&kind=thread'
  assert.deepEqual(query.change({ q: undefined, tag: undefined, kind: undefined }), {
    navigate: true,
    search: 'set=brand',
  })
})
