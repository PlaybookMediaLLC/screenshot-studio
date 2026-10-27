import assert from 'node:assert/strict'
import { test } from 'node:test'
import nextConfig from '../next.config'

test('Home is not cross-origin isolated, so its render frame previews can load', async () => {
  const rules = (await nextConfig.headers?.()) ?? []
  const isolating = rules.filter(
    (rule) =>
      rule.source === '/home' &&
      rule.headers.some((header) => header.key === 'Cross-Origin-Embedder-Policy')
  )
  assert.deepEqual(isolating, [])
})
