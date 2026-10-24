import assert from 'node:assert/strict'
import test from 'node:test'
import { POST_BREAK, SOCIAL_MENTION } from '@/lib/content-drafts/serialize'
import type { PlateBody } from '@/lib/write/document'
import { buildPublication, type PublicationDraft } from '@/lib/write/publication'
import { forkVersion, readVersions, withOptions } from '@/lib/write/versions'

const p = (text: string) => ({ children: [{ text }], type: 'p' })
const brk = (extra: object = {}) => ({ children: [{ text: '' }], type: POST_BREAK, ...extra })
const body: PlateBody = [
  brk({ id: 'a', replySettings: 'following', disclosures: { madeWithAi: true } }),
  p('First post'),
  brk({ id: 'b' }),
  p('Second post'),
  brk({ id: 'c' }),
  p('Follow for more'),
]
const draft = (extra: Partial<PublicationDraft> = {}): PublicationDraft => ({
  article: null,
  body,
  kind: 'standard',
  platformVersions: readVersions(undefined),
  target: null,
  ...extra,
})
const x = { channel: 'x' as const, connectionId: 'cx0000000001' }
const linkedin = { channel: 'linkedin' as const, connectionId: 'cl0000000001' }

test('an X thread sends each post with its own settings', () => {
  const { problems, target } = buildPublication(draft(), x)
  assert.deepEqual(problems, [])
  assert.equal(target.caption, 'First post')
  assert.deepEqual(target.options, { madeWithAi: true, replySettings: 'following' })
  assert.deepEqual(
    target.replies?.map((reply) => [reply.caption, reply.options]),
    [
      ['Second post', undefined],
      ['Follow for more', undefined],
    ]
  )
})

test('numbering is counted and applied for the X version only', () => {
  const versions = withOptions(readVersions(undefined), 'x', {
    numbering: { enabled: true, position: 'end', style: 'fraction' },
  })
  const numbered = buildPublication(draft({ platformVersions: versions }), x)
  assert.deepEqual(
    numbered.serialized.posts.map((post) => post.caption),
    ['First post 1/3', 'Second post 2/3', 'Follow for more 3/3']
  )
  assert.equal(numbered.serialized.posts[0].length, 'First post 1/3'.length)
  // LinkedIn joins the thread and takes no X settings.
  const joined = buildPublication(draft({ platformVersions: versions }), linkedin)
  assert.equal(joined.target.caption, 'First post\n\nSecond post\n\nFollow for more')
  assert.equal(joined.target.options, undefined)
  assert.equal(joined.target.replies, undefined)
})

test('a manual LinkedIn version publishes its own text and options', () => {
  let versions = forkVersion(readVersions(undefined), 'linkedin', body, 3, false)
  versions = {
    ...versions,
    versions: versions.versions.map((version) => ({
      ...version,
      body: [brk({ id: 'l' }), p('LinkedIn words')],
      options: { firstComment: 'Link in comments', visibility: 'CONNECTIONS' as const },
    })),
  }
  const { target } = buildPublication(draft({ platformVersions: versions }), linkedin)
  assert.equal(target.caption, 'LinkedIn words')
  assert.deepEqual(target.options, { firstComment: 'Link in comments', visibility: 'CONNECTIONS' })
  // X still follows the primary.
  assert.equal(
    buildPublication(draft({ platformVersions: versions }), x).target.caption,
    'First post'
  )
})

test('polls follow each platform’s rules', () => {
  const poll = (extra: object) => [
    brk({ id: 'a', poll: { durationMinutes: 1440, options: ['Yes', 'No'], ...extra } }),
    p('Ship it?'),
  ]
  const ok = buildPublication(draft({ body: poll({ question: 'Ship it?' }) }), linkedin)
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.target.options, { pollQuestion: 'Ship it?' })
  const noQuestion = buildPublication(draft({ body: poll({}) }), linkedin)
  assert.ok(noQuestion.problems.includes('Ask the poll question.'))
  const xPoll = buildPublication(draft({ body: poll({}) }), x)
  assert.deepEqual(xPoll.problems, [])
  assert.deepEqual(xPoll.target.poll, { durationMinutes: 1440, options: ['Yes', 'No'] })
  assert.deepEqual(buildPublication(draft({ body: poll({ durationMinutes: 6 }) }), x).problems, [])
  const longOption = buildPublication(draft({ body: poll({ options: ['a'.repeat(26), 'b'] }) }), x)
  assert.ok(longOption.problems.some((problem) => problem.includes('25 characters')))
  const withMedia = buildPublication(
    draft({
      body: [
        ...poll({ question: 'Q?' }),
        { assetId: 'cimage000001', children: [{ text: '' }], type: 'img' },
      ],
    }),
    linkedin
  )
  assert.ok(withMedia.problems.some((problem) => problem.includes('cannot have media')))
})

test('an X poll on a later post survives serialization with its own limits', () => {
  const body = [
    brk({ id: 'a' }),
    p('Introduction'),
    brk({ id: 'b', poll: { durationMinutes: 6, options: ['Yes', 'No'] } }),
    p('Ship it?'),
  ]
  const result = buildPublication(draft({ body }), x)
  assert.deepEqual(result.problems, [])
  assert.equal(result.target.poll, undefined)
  assert.deepEqual(result.target.replies?.[0].poll, { durationMinutes: 6, options: ['Yes', 'No'] })
  const invalid = buildPublication(
    draft({ body: [...body, { type: 'img', assetId: 'cimage000001', children: [{ text: '' }] }] }),
    x
  )
  assert.ok(
    invalid.problems.some((problem) => problem.startsWith('Post 2:') && problem.includes('media'))
  )
})

test('LinkedIn rejects invalid poll durations, raw length overflow and reshares before scheduling', () => {
  const content = (extra: object = {}) => [
    brk({
      poll: { question: 'Ship it?', durationMinutes: 1440, options: ['Yes', 'No'], ...extra },
    }),
    p('Release poll'),
  ]
  for (const durationMinutes of [1440, 4320, 10080, 20160]) {
    assert.deepEqual(
      buildPublication(draft({ body: content({ durationMinutes }) }), linkedin).problems,
      []
    )
  }
  for (const extra of [
    { durationMinutes: 5 },
    { durationMinutes: 1441 },
    { options: ['Only one'] },
    { question: ` ${'界'.repeat(140)} ` },
    { options: [` ${'界'.repeat(30)} `, 'No'] },
    { multiple: true },
  ]) {
    assert.ok(buildPublication(draft({ body: content(extra) }), linkedin).problems.length > 0)
  }
  assert.deepEqual(
    buildPublication(draft({ body: content({ question: '界'.repeat(140) }) }), linkedin).problems,
    []
  )
  assert.ok(
    buildPublication(
      draft({
        kind: 'quote',
        body: content(),
        target: {
          platform: 'linkedin',
          remoteId: 'urn:li:share:123456789',
          url: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
        },
      }),
      linkedin
    ).problems.includes('A LinkedIn reshare cannot contain a poll.')
  )
})

test('kinds carry their target; Articles need verified access and a title', () => {
  const reply = buildPublication(
    draft({
      kind: 'reply',
      target: { platform: 'x', remoteId: '123', url: 'https://x.com/a/status/123' },
    }),
    x
  )
  assert.equal(reply.target.replyTo, '123')
  const quote = buildPublication(
    draft({
      kind: 'quote',
      target: { platform: 'x', remoteId: '9', url: 'https://x.com/a/status/9' },
    }),
    x
  )
  assert.equal(quote.target.options?.quoteRemoteId, '9')
  assert.ok(quote.problems.some((problem) => problem.includes('Enterprise API')))
  const finisher = buildPublication(
    draft({ body: [p('Root'), brk({ quoteFirstPost: true }), p('End')] }),
    x
  )
  assert.ok(finisher.problems.some((problem) => problem.includes('Enterprise API')))
  const standard = buildPublication(draft({ article: { title: 'Why' }, kind: 'article' }), x)
  assert.ok(standard.problems.some((problem) => problem.includes('Reconnect X')))
  const premium = buildPublication(
    draft({ article: { title: '' }, kind: 'article', body: [p('Article body')] }),
    {
      ...x,
      standing: { maxWeightedCharacters: 25_000, articles: true },
    }
  )
  assert.deepEqual(premium.problems, ['Give the article a title.'])
})

test('verified capabilities set the account text limit independently of Articles', () => {
  const long = draft({ body: [brk({ id: 'a' }), p('a'.repeat(400))] })
  assert.ok(buildPublication(long, x).problems.some((problem) => problem.includes('400 of 280')))
  assert.deepEqual(
    buildPublication(long, { ...x, standing: { maxWeightedCharacters: 25_000, articles: true } })
      .problems,
    []
  )
  const basic = { ...x, standing: { maxWeightedCharacters: 25_000 as const, articles: false } }
  assert.deepEqual(buildPublication(long, basic).problems, [])
  const article = draft({ body: [p('Article')], kind: 'article', article: { title: 'Why' } })
  assert.ok(
    buildPublication(article, basic).problems.some((problem) =>
      problem.includes('eligible account')
    )
  )
  assert.ok(
    buildPublication(article, { ...x, standing: { maxWeightedCharacters: 25_000 } }).problems.some(
      (problem) => problem.includes('Reconnect X')
    )
  )
})

test('mentions serialize the way each platform reads them', () => {
  const mention = {
    children: [{ text: '' }],
    handle: '',
    label: 'Acme Corp',
    platform: 'linkedin',
    providerId: 'urn:li:organization:42',
    type: SOCIAL_MENTION,
  }
  const mentioned = draft({
    body: [
      brk({ id: 'a' }),
      { children: [{ text: 'Thanks ' }, mention, { text: '!' }], type: 'p' },
    ],
  })
  assert.equal(
    buildPublication(mentioned, linkedin).target.caption,
    'Thanks @[Acme Corp](urn:li:organization:42)!'
  )
  assert.equal(buildPublication(mentioned, x).target.caption, 'Thanks Acme Corp!')
})

test('Mastodon polls use the connected server limits and preserve multiple choice independently of X', () => {
  const poll = { durationMinutes: 6, multiple: true, options: ['A', 'B', 'C', 'D', 'E'] }
  const content = draft({ body: [brk({ poll }), p('Choose your favorites')] })
  const account = {
    channel: 'mastodon' as const,
    connectionId: 'cm000000001',
    standing: {
      pollLimits: {
        maxOptions: 6,
        maxOptionCharacters: 80,
        minDurationSeconds: 300,
        maxDurationSeconds: 604800,
      },
    },
  }
  const built = buildPublication(content, account)
  assert.deepEqual(built.problems, [])
  assert.equal(built.target.poll?.multiple, true)
  assert.equal(built.target.poll?.durationMinutes, 6)
  assert.equal(built.target.poll?.options.length, 5)
  assert.ok(
    buildPublication(content, { ...account, standing: undefined }).problems.some((text) =>
      text.includes('verify this server')
    )
  )
  const xVersion = buildPublication(content, x)
  assert.ok(xVersion.problems.some((text) => text.includes('2 to 4')))
  assert.ok(xVersion.problems.some((text) => text.includes('Multiple-choice')))
})

test('Bluesky quotes retain native post references and finishers wait for the root', () => {
  const uri = 'at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/source'
  const result = buildPublication(
    draft({
      kind: 'quote',
      body: [p('My take'), brk({ quoteFirstPost: true }), p('Finisher')],
      target: {
        platform: 'bluesky',
        remoteId: uri,
        url: 'https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/source',
      },
    }),
    { channel: 'bluesky', connectionId: 'cb0000000001' }
  )
  assert.deepEqual(result.problems, [])
  assert.equal(result.target.options?.quoteRemoteId, uri)
  assert.equal(result.target.replies?.[0].options?.quoteFirstPost, true)
})

test('Threads polls use native single-choice 24-hour text-only rules', () => {
  const account = { channel: 'threads' as const, connectionId: 'ct0000000001' }
  const post = (changes: object = {}) =>
    draft({
      body: [
        brk({ poll: { options: ['Yes', 'No'], durationMinutes: 1440, ...changes } }),
        p('Choose'),
      ],
    })
  const good = buildPublication(post(), account)
  assert.deepEqual(good.problems, [])
  assert.deepEqual(good.target.poll, { options: ['Yes', 'No'], durationMinutes: 1440 })
  for (const changes of [
    { durationMinutes: 60 },
    { multiple: true },
    { options: ['x'.repeat(26), 'No'] },
    { question: 'Separate question' },
  ])
    assert.ok(buildPublication(post(changes), account).problems.length > 0)
  const withMedia = post()
  withMedia.body.push({ type: 'img', assetId: 'cimage000001', children: [{ text: '' }] })
  assert.ok(
    buildPublication(withMedia, account).problems.some((problem) => problem.includes('media'))
  )
})

test('link preview removal is persisted and cannot be silently ignored by a provider', () => {
  const card = { url: 'https://example.com/story', title: 'Story', removed: true }
  let versions = withOptions(readVersions(undefined), 'bluesky', { linkPreviews: [card] })
  const value = draft({ body: [p('Read https://example.com/story')], platformVersions: versions })
  assert.equal(
    buildPublication(value, { channel: 'bluesky', connectionId: 'cb0000000001' }).target.options
      ?.linkPreview?.removed,
    true
  )
  versions = withOptions(versions, 'x', { linkPreviews: [card] })
  assert.ok(
    buildPublication({ ...value, platformVersions: versions }, x).problems.some((problem) =>
      problem.includes('preview removal')
    )
  )
  const unrelated = draft({ body: [p('A different post')], platformVersions: versions })
  assert.equal(
    buildPublication(unrelated, { channel: 'bluesky', connectionId: 'cb0000000001' }).target.options
      ?.linkPreview,
    undefined
  )
})

test('Mastodon quotes require a verified server and quote lookup scopes', () => {
  const value = draft({
    kind: 'quote',
    body: [p('Commentary')],
    target: {
      platform: 'mastodon',
      remoteId: 'https://source.social/@person/123',
      url: 'https://source.social/@person/123',
    },
  })
  const account = { channel: 'mastodon' as const, connectionId: 'cm0000000001' }
  assert.ok(
    buildPublication(value, account).problems.some((problem) => problem.includes('Reconnect'))
  )
  const allowed = buildPublication(value, { ...account, standing: { mastodonQuotes: true } })
  assert.deepEqual(allowed.problems, [])
  assert.equal(allowed.target.options?.quoteRemoteId, 'https://source.social/@person/123')
})

test('TF-075 numbering follows edits on every thread platform without changing authored content', () => {
  for (const channel of ['x', 'threads', 'bluesky', 'mastodon'] as const) {
    const versions = withOptions(readVersions(undefined), channel, {
      numbering: { enabled: true, position: 'start', style: 'fraction' },
    })
    const authored = [brk({ id: 'c' }), p('Moved first'), brk({ id: 'a' }), p('Moved last')]
    const snapshot = JSON.stringify(authored)
    const input = draft({ body: authored, platformVersions: versions })
    const account = { channel, connectionId: 'account' }
    const first = buildPublication(input, account)
    assert.equal(first.target.caption, '1/2 Moved first')
    assert.equal(first.target.replies?.[0].caption, '2/2 Moved last')
    assert.deepEqual(buildPublication(input, account).target, first.target)
    assert.equal(JSON.stringify(authored), snapshot)
    const shortened = buildPublication({ ...input, body: authored.slice(0, 2) }, account)
    assert.equal(shortened.target.caption, 'Moved first')
  }
})
