import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalRedirect } from '@/lib/canonical-host'

test('pages on the retired host move to the canonical host with path and query', () => {
  const moved = canonicalRedirect(
    new URL('http://shots.oppulence.io/campaigns/1?tab=assets'),
    'Shots.Oppulence.io'
  )
  assert.equal(moved?.toString(), 'https://shots.playbookmedia.io/campaigns/1?tab=assets')
  // Production sees the internal port; it must not leak into the redirect.
  assert.equal(
    canonicalRedirect(
      new URL('http://shots.oppulence.io:3000/pricing'),
      'shots.oppulence.io'
    )?.toString(),
    'https://shots.playbookmedia.io/pricing'
  )
  assert.equal(
    canonicalRedirect(new URL('https://shots.playbookmedia.io/'), 'shots.playbookmedia.io'),
    null
  )
  assert.equal(canonicalRedirect(new URL('http://localhost:3000/'), null), null)
})
