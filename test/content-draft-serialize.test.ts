import assert from 'node:assert/strict'
import test from 'node:test'
import {
  channelForPlatform,
  draftPlainText,
  renderableBlockCount,
  serializeDraft,
} from '@/lib/content-drafts/serialize'

const p = (...children: object[]) => ({ type: 'p', children })
const text = (value: string, marks: object = {}) => ({ text: value, ...marks })

test('paragraphs, headings and soft breaks become plain text', () => {
  const result = serializeDraft(
    [
      { type: 'h1', children: [text('Launch day')] },
      p(text('Line one\nline two')),
      p(text('Second paragraph')),
    ],
    'linkedin'
  )
  assert.equal(result.caption, 'Launch day\n\nLine one\nline two\n\nSecond paragraph')
  assert.deepEqual(result.degradations, [])
  assert.deepEqual(result.errors, [])
})

test('indent lists keep their markers, numbering and nesting', () => {
  const item = (value: string, listStyleType: string, indent = 1, extra: object = {}) => ({
    type: 'p',
    listStyleType,
    indent,
    ...extra,
    children: [text(value)],
  })
  const result = serializeDraft(
    [
      p(text('Steps:')),
      item('Install', 'decimal'),
      item('Configure', 'decimal'),
      item('Detail', 'disc', 2),
      item('Ship', 'decimal'),
      item('Done', 'todo', 1, { checked: true }),
      p(text('After')),
    ],
    'linkedin'
  )
  assert.equal(
    result.caption,
    'Steps:\n\n1. Install\n2. Configure\n  - Detail\n3. Ship\n[x] Done\n\nAfter'
  )
})

test('links, mentions and hashtags become plain text', () => {
  const result = serializeDraft(
    [
      p(
        text('Read '),
        { type: 'a', url: 'https://shots.example/blog', children: [text('the post')] },
        text(' by '),
        { type: 'mention', value: 'ada', children: [text('')] },
        text(' '),
        { type: 'tag', value: 'launch', children: [text('')] },
        text(' '),
        { type: 'a', url: 'https://shots.example', children: [text('https://shots.example')] }
      ),
    ],
    'x'
  )
  assert.equal(
    result.caption,
    'Read the post (https://shots.example/blog) by @ada #launch https://shots.example'
  )
})

test('tables become aligned rows and are reported', () => {
  const cell = (value: string) => ({ type: 'td', children: [p(text(value))] })
  const result = serializeDraft(
    [
      {
        type: 'table',
        children: [
          { type: 'tr', children: [cell('Plan'), cell('Price')] },
          { type: 'tr', children: [cell('Pro'), cell('$29')] },
          { type: 'tr', children: [cell('Business'), cell('$99')] },
          { type: 'tr', children: [cell(''), cell('')] },
        ],
      },
    ],
    'linkedin'
  )
  assert.equal(result.caption, 'Plan     | Price\nPro      | $29\nBusiness | $99')
  assert.deepEqual(
    result.degradations.map((item) => item.kind),
    ['table']
  )
})

test('math is posted as its source and footnotes as numbered notes', () => {
  const result = serializeDraft(
    [
      p(
        text('Energy '),
        { type: 'inline_equation', texExpression: 'E=mc^2', children: [text('')] },
        text(' holds'),
        { type: 'footnoteReference', identifier: 'b', children: [text('')] },
        text(' everywhere'),
        { type: 'footnoteReference', identifier: 'a', children: [text('')] }
      ),
      { type: 'equation', texExpression: '\\int_0^1 x\\,dx', children: [text('')] },
      { type: 'footnoteDefinition', identifier: 'a', children: [p(text('Second note.'))] },
      { type: 'footnoteDefinition', identifier: 'b', children: [p(text('First note.'))] },
    ],
    'linkedin'
  )
  assert.equal(
    result.caption,
    'Energy E=mc^2 holds[1] everywhere[2]\n\n\\int_0^1 x\\,dx\n\n[1] First note.\n[2] Second note.'
  )
  assert.deepEqual(result.degradations.map((item) => item.kind).sort(), ['footnotes', 'math'])
})

test('unsupported marks are dropped and reported once', () => {
  const result = serializeDraft(
    [
      p(
        text('Big', { bold: true }),
        text(' and ', {}),
        text('loud', { italic: true, color: 'red' })
      ),
    ],
    'x'
  )
  assert.equal(result.caption, 'Big and loud')
  assert.deepEqual(result.degradations, [
    { kind: 'formatting', message: 'Bold, italic and other formatting are removed.' },
  ])
})

test('images become attachments; embeds are reported', () => {
  const result = serializeDraft(
    [
      p(text('Look')),
      {
        type: 'img',
        assetId: 'asset-1',
        url: '/api/v1/assets/asset-1/content',
        children: [text('')],
      },
      {
        type: 'img',
        assetId: 'asset-2',
        url: '/api/v1/assets/asset-2/content',
        children: [text('')],
      },
      { type: 'video', url: 'https://video.example/v', children: [text('')] },
    ],
    'instagram'
  )
  assert.equal(result.caption, 'Look')
  assert.deepEqual(result.assetIds, ['asset-1', 'asset-2'])
  assert.deepEqual(result.degradations.map((item) => item.kind).sort(), ['embed'])
  assert.deepEqual(result.errors, [])
})

test('images past the channel limit are reported, not dropped from the draft', () => {
  const images = Array.from({ length: 5 }, (_, index) => ({
    type: 'img',
    assetId: `asset-${index}`,
    url: `/api/v1/assets/asset-${index}/content`,
    children: [text('')],
  }))
  const x = serializeDraft([p(text('Look')), ...images], 'x')
  assert.equal(x.assetIds.length, 5)
  assert.deepEqual(x.degradations, [
    { kind: 'extra-images', message: 'Only the first 4 images are attached.' },
  ])
  assert.deepEqual(serializeDraft([p(text('Look')), ...images], 'linkedin').degradations, [])
})

test('an image inside a paragraph is attached too', () => {
  const result = serializeDraft(
    [p(text('Notes'), { type: 'img', assetId: 'asset-9', url: '/x', children: [text('')] })],
    'x'
  )
  assert.equal(result.caption, 'Notes')
  assert.deepEqual(result.assetIds, ['asset-9'])
})

test('channel limits and requirements block scheduling', () => {
  const long = serializeDraft([p(text('a'.repeat(281)))], 'x')
  assert.equal(long.length, 281)
  assert.equal(long.limit, 280)
  assert.match(long.errors[0], /281 of 280/)
  assert.deepEqual(serializeDraft([p(text('a'.repeat(281)))], 'linkedin').errors, [])
  assert.deepEqual(serializeDraft([p(text('No picture'))], 'instagram').errors, [
    'Instagram needs an image.',
  ])
  assert.deepEqual(serializeDraft([], 'x').errors, ['Write something to post.'])
  const external = serializeDraft(
    [p(text('Hi')), { type: 'img', url: 'https://elsewhere.example/a.png', children: [text('')] }],
    'x'
  )
  assert.deepEqual(external.errors, ['Upload every image to the workspace before scheduling.'])
  // UTF-16, as X and the backend count: one emoji is two units.
  assert.equal(serializeDraft([p(text('🚀'))], 'x').length, 2)
})

test('connection platforms map to draft channels', () => {
  assert.equal(channelForPlatform('instagram-standalone'), 'instagram')
  assert.equal(channelForPlatform('x'), 'x')
  assert.equal(channelForPlatform('tiktok'), null)
  assert.equal(draftPlainText([p(text('Hello'), text(' world', { bold: true }))]), 'Hello world')
})

test('rendered tables and math blocks post as images in body order', () => {
  const value = [
    p(text('Pricing')),
    { type: 'equation', id: 'eq', texExpression: 'E = mc^2', children: [text('')] },
    { type: 'img', assetId: 'photo', url: '/api/v1/assets/photo/content', children: [text('')] },
    {
      type: 'table',
      id: 'tbl',
      children: [{ type: 'tr', children: [{ type: 'td', children: [p(text('Plan'))] }] }],
    },
  ]
  assert.equal(renderableBlockCount(value), 2)
  const preview = serializeDraft(value, 'instagram', ['', ''])
  assert.equal(preview.caption, 'Pricing')
  assert.deepEqual(preview.assetIds, ['photo'])
  assert.deepEqual(preview.errors, [])
  assert.deepEqual(preview.degradations.map((item) => item.message).sort(), [
    'Math blocks are posted as images.',
    'Tables are posted as images.',
  ])
  const posted = serializeDraft(value, 'x', ['eq-png', 'tbl-png'])
  assert.deepEqual(posted.assetIds, ['eq-png', 'photo', 'tbl-png'])
  // A block that failed to render posts as text.
  const partly = serializeDraft(value, 'x', ['eq-png', null])
  assert.deepEqual(partly.assetIds, ['eq-png', 'photo'])
  assert.match(partly.caption, /Plan/)
  // Without rendered images, both stay text.
  assert.match(serializeDraft(value, 'x').caption, /E = mc\^2[\s\S]*Plan/)
})
