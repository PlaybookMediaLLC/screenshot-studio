import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasNavigationFailure } from '@/lib/canvas/navigation-diagnostics'

test('page-data diagnostics keep the status and route without private identifiers', () => {
  const origin = 'https://shots.example.test'
  assert.deepEqual(
    canvasNavigationFailure(
      {
        name: `${origin}/fr/canvas/private-id?_rsc=secret&search=private-title`,
        responseStatus: 503,
        duration: 123.4,
      },
      origin
    ),
    { route: '/canvas/[canvasId]', status: 503, duration_ms: 123 }
  )
  for (const name of [
    `${origin}/canvas`,
    `${origin}/api/trpc/canvas.get?_rsc=x`,
    'https://other.example/canvas?_rsc=x',
    'invalid',
  ])
    assert.equal(canvasNavigationFailure({ name, responseStatus: 503, duration: 1 }, origin), null)
  for (const responseStatus of [undefined, 0, 200, 307, 404]) {
    assert.equal(
      canvasNavigationFailure(
        { name: `${origin}/canvas?_rsc=x`, responseStatus, duration: 1 },
        origin
      ),
      null
    )
  }
})
