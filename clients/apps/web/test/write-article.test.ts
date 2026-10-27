import test from 'node:test'
import assert from 'node:assert/strict'
import { articleContent } from '@/lib/write/article'
import { buildPublication } from '@/lib/write/publication'
import { EMPTY_PLATFORM_VERSIONS, type PlateBody } from '@/lib/write/document'

test('rich articles preserve marks, paragraphs, list kinds, image positions and native post identities', () => {
  const body: PlateBody = [
    { type: 'h1', children: [{ text: '<Title>' }] },
    {
      type: 'p',
      children: [
        { text: 'Bold', bold: true },
        { text: 'italic\nnext', italic: true },
      ],
    },
    { type: 'p', children: [{ text: '' }] },
    { type: 'p', listStyleType: 'decimal', children: [{ text: 'First' }] },
    { type: 'img', assetId: 'casset000001', alt: '"quoted"', children: [{ text: '' }] },
    { type: 'media_embed', url: 'https://x.com/name/status/123', children: [{ text: '' }] },
  ]
  const rich = articleContent(body)
  assert.deepEqual(rich.problems, [])
  assert.match(rich.html, /<h1>&lt;Title&gt;<\/h1>/)
  assert.match(rich.html, /<em>italic<br>next<\/em>/)
  assert.match(rich.html, /<p><\/p><ol><li>First<\/li><\/ol>/)
  assert.match(rich.html, /data-asset-id="casset000001" alt="&quot;quoted&quot;"/)
  assert.match(rich.html, /data-x-post="123"/)
  const publication = buildPublication(
    {
      article: { title: 'Article' },
      body,
      kind: 'article',
      platformVersions: EMPTY_PLATFORM_VERSIONS,
      target: null,
    },
    { channel: 'x', connectionId: 'cx000000001', standing: { articles: true } }
  )
  assert.equal(publication.target.options?.articleHtml, rich.html)
  assert.deepEqual(publication.problems, [])
  assert.equal(publication.serialized.degradations.length, 0)
  assert.deepEqual(publication.target.assetIds, ['casset000001'])
})

test('article conversion refuses unsupported media and unsafe links instead of silently discarding them', () => {
  const rich = articleContent([
    { type: 'video', assetId: 'casset000001', children: [{ text: '' }] },
    {
      type: 'p',
      children: [{ type: 'a', url: 'javascript:alert(1)', children: [{ text: 'safe' }] }],
    },
  ])
  assert.equal(rich.problems.length, 2)
  assert.equal(rich.html.includes('javascript:'), false)
})
