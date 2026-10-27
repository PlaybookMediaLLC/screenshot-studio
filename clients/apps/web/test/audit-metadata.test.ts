import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAuditSearchText, sanitizeAuditMetadata } from '@/lib/audit/metadata'

test('audit metadata redacts sensitive values', () => {
  const metadata = sanitizeAuditMetadata({
    label: 'release',
    signedUrl: 'secret-url',
    token: 'secret',
  })
  assert.deepEqual(metadata, { label: 'release', signedUrl: '[REDACTED]', token: '[REDACTED]' })
})

test('audit search text excludes empty values and bounds output', () => {
  assert.equal(
    buildAuditSearchText(['release.created', null, undefined, 'artifact']),
    'release.created artifact'
  )
  assert.equal(buildAuditSearchText(['x'.repeat(1_001)]).length, 1_000)
})
