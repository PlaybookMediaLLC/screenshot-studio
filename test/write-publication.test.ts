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
  const premium = buildPublication(draft({ article: { title: '' }, kind: 'article' }), {
    ...x,
    standing: { maxWeightedCharacters: 25_000, articles: true },
  })
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

test('Mastodon polls require instance limits and preserve exact native choices', () => {
  const body = [
    brk({
      id: 'poll',
      poll: {
        durationMinutes: 6,
        multiple: true,
        options: [' A ', '界'.repeat(40), 'C', 'D', 'E'],
      },
    }),
    p('Choose'),
  ]
  const account = { channel: 'mastodon' as const, connectionId: 'cmastodon01' }
  assert.ok(buildPublication(draft({ body }), account).problems.length)
  const standing = {
    pollLimits: {
      max_options: 5,
      max_characters_per_option: 40,
      min_expiration: 300,
      max_expiration: 3600,
    },
  }
  const publication = buildPublication(draft({ body }), { ...account, standing })
  assert.deepEqual(publication.problems, [])
  assert.equal(publication.target.poll?.multiple, true)
  assert.equal(publication.target.poll?.options[0], ' A ')
  const stricter = { pollLimits: { ...standing.pollLimits, max_options: 4 } }
  assert.ok(
    buildPublication(draft({ body }), { ...account, standing: stricter }).problems.some((p) =>
      p.includes('2 to 4')
    )
  )
})

test('X polls accept any documented minute duration without trimming choices', () => {
  const body = [
    brk({ id: 'poll', poll: { durationMinutes: 6, options: [' A ', 'B'] } }),
    p('Choose'),
  ]
  const publication = buildPublication(draft({ body }), x)
  assert.deepEqual(publication.problems, [])
  assert.equal(publication.target.poll?.options[0], ' A ')
})

test('Threads polls use native options and provider-controlled duration', () => {
  const poll = { options: [' Choice ', 'Second'], durationMinutes: 0 }
  const result = buildPublication(draft({ body: [brk({ poll }), p('Choose?')] }), {
    channel: 'threads',
    connectionId: 'threads',
  })
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.target.poll, { options: poll.options, durationMinutes: 0 })
  const wrong = buildPublication(
    draft({ body: [brk({ poll: { ...poll, durationMinutes: 1440 } }), p('Choose?')] }),
    { channel: 'threads', connectionId: 'threads' }
  )
  assert.ok(wrong.problems.some((message) => message.includes('poll lengths')))
})

test('native Bluesky and verified Mastodon quote finishers retain channel settings', () => {
  for (const channel of ['bluesky', 'mastodon'] as const) {
    const data = draft({ body: [p('Root'), brk({ quoteFirstPost: true }), p('Finisher')] })
    const result = buildPublication(data, {
      channel,
      connectionId: 'cquote001',
      standing: { nativeQuotes: true },
    })
    assert.deepEqual(result.problems, [])
    assert.equal(result.target.replies?.[0].options?.quoteFirstPost, true)
    if (channel === 'mastodon')
      assert.match(
        buildPublication(data, { channel, connectionId: 'cquote001' }).problems.join(),
        /native quote/
      )
  }
})

test('X photo tags survive publication and require photos', () => {
  const result = buildPublication(draft({ body: [brk({ photoTagIds: ['123'] }), p('Caption')] }), x)
  assert.deepEqual(result.target.options?.photoTagIds, ['123'])
  assert.match(result.problems.join(), /attached photo/)
  const linkedinResult = buildPublication(
    draft({ body: [brk({ photoTagIds: ['123'] }), p('Caption')] }),
    linkedin
  )
  assert.equal(linkedinResult.target.options?.photoTagIds, undefined)
})

test('preview media kinds follow the selected channel version without borrowing primary attachments', () => {
  const primary = [p('Primary'), { type: 'img', assetId: 'cimage000001', children: [{ text: '' }] }]
  let versions = forkVersion(readVersions(undefined), 'linkedin', primary, 1, false)
  versions = {
    ...versions,
    versions: versions.versions.map((v) => ({
      ...v,
      body: [p('Manual'), { type: 'video', assetId: 'cvideo000001', children: [{ text: '' }] }],
    })),
  }
  assert.deepEqual(
    buildPublication(draft({ body: primary, platformVersions: versions }), x).mediaTypes,
    { cimage000001: 'image' }
  )
  assert.deepEqual(
    buildPublication(draft({ body: primary, platformVersions: versions }), linkedin).mediaTypes,
    { cvideo000001: 'video' }
  )
})

test('synced Bluesky and Instagram versions cannot silently discard a primary poll', () => {
  const source = draft({
    body: [brk({ poll: { options: ['A', 'B'], durationMinutes: 0 } }), p('Choose a direction')],
  })
  for (const channel of ['bluesky', 'instagram'] as const) {
    assert.ok(
      buildPublication(source, { channel, connectionId: 'cunsupported00001' }).problems.some(
        (problem) => problem.includes('cannot carry a poll')
      )
    )
  }
})
