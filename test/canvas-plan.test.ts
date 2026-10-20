import assert from 'node:assert/strict'
import test from 'node:test'
import { artboardRect } from '@/lib/canvas/document'
import { releaseCanvas, releaseEvidence, stacked } from '@/lib/canvas/plan'
import { DEFAULT_CANVAS_PADDING as SERVER_PADDING } from '@/lib/export/adapt'
import { DEFAULT_CANVAS_PADDING } from '@/lib/store'

test('server layout uses the editor padding', () => {
  assert.equal(SERVER_PADDING, DEFAULT_CANVAS_PADDING)
})

test('release evidence keeps only the record’s own words and safe links', () => {
  const evidence = releaseEvidence({
    id: 'r1',
    title: 'Bulk approvals',
    benefitStatement: '',
    features: [
      { title: 'Approve ten at once', url: 'https://example.com/pr/1' },
      { title: '  ' },
      { title: 'Queue', url: 'javascript:alert(1)' },
    ],
  })
  assert.deepEqual(evidence, {
    id: 'r1',
    title: 'Bulk approvals',
    benefitStatement: undefined,
    features: [
      { title: 'Approve ten at once', url: 'https://example.com/pr/1' },
      { title: 'Queue' },
    ],
  })
})

test('a release canvas stacks each recipe in its own row and repeats with seeded ids', () => {
  const seeded = () => {
    let n = 0
    return () => `id-${++n}`
  }
  const fill = () => 'asset:00000000-0000-4000-8000-000000000000'
  const input = {
    release: releaseEvidence({ id: 'r1', title: 'Bulk approvals', benefitStatement: 'One queue.' }),
    screenshots: [
      {
        src: 'asset:11111111-1111-4111-8111-111111111111',
        name: 'Shot',
        width: 1600,
        height: 1000,
      },
    ],
  }
  const first = releaseCanvas(['feature-announcement', 'social-pack'], input, {
    newId: seeded(),
    fill,
  })
  const second = releaseCanvas(['feature-announcement', 'social-pack'], input, {
    newId: seeded(),
    fill,
  })
  assert.deepEqual(first, second, 'the same release and ids lay out the same canvas')
  const [hero, ...social] = first
  assert.ok(social.length >= 2)
  // Social formats sit in a row below the announcement.
  const bottom = artboardRect(hero!).y + artboardRect(hero!).height
  assert.ok(social.every((artboard) => artboard.y > bottom))
  assert.ok(JSON.stringify(first).includes('Bulk approvals'))
  assert.deepEqual(stacked(), [])
})
