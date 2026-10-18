import assert from 'node:assert/strict'
import test from 'node:test'
import {
  embedSnippets,
  expiryDate,
  isLive,
  shareMediaUrl,
  shareTokenSchema,
  shareUrl,
} from '@/lib/sharing/schema'

const ORIGIN = 'https://shots.example'
const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF12'

test('lifetimes become expiry instants', () => {
  const now = new Date('2026-10-16T12:00:00Z')
  assert.equal(expiryDate('never', now), null)
  assert.equal(expiryDate('1d', now), '2026-10-17T12:00:00.000Z')
  assert.equal(expiryDate('30d', now), '2026-11-15T12:00:00.000Z')
})

test('a link is live until it expires or is revoked', () => {
  const now = new Date('2026-10-16T12:00:00Z')
  assert.equal(isLive({ expiresAt: null, revokedAt: null }, now), true)
  assert.equal(isLive({ expiresAt: new Date('2026-10-17T00:00:00Z'), revokedAt: null }, now), true)
  assert.equal(isLive({ expiresAt: new Date('2026-10-16T11:00:00Z'), revokedAt: null }, now), false)
  assert.equal(isLive({ expiresAt: null, revokedAt: new Date('2026-10-01T00:00:00Z') }, now), false)
})

test('share and media URLs point at the app, never at the editor', () => {
  assert.equal(shareUrl(ORIGIN, TOKEN), `${ORIGIN}/s/${TOKEN}`)
  assert.equal(shareMediaUrl(ORIGIN, TOKEN), `${ORIGIN}/api/share/${TOKEN}/media`)
  assert.equal(
    shareMediaUrl(ORIGIN, TOKEN, 'poster'),
    `${ORIGIN}/api/share/${TOKEN}/media?variant=poster`
  )
  assert.equal(shareTokenSchema.safeParse('../../etc/passwd').success, false)
  assert.equal(shareTokenSchema.safeParse(TOKEN).success, true)
})

test('embed snippets reference the published link and escape text', () => {
  const image = embedSnippets(ORIGIN, {
    altText: 'A "launch" <hero>',
    height: 630,
    mediaType: 'image/png',
    title: 'Launch [v2]',
    token: TOKEN,
    width: 1200,
  })
  assert.match(image.iframe, new RegExp(`src="${ORIGIN}/s/${TOKEN}/embed"`))
  assert.match(image.iframe, /aspect-ratio:1200\/630/)
  assert.match(image.html, /alt="A &quot;launch&quot; &lt;hero&gt;"/)
  assert.match(
    image.html,
    new RegExp(`<a href="${ORIGIN}/s/${TOKEN}"><img src="${ORIGIN}/api/share/${TOKEN}/media"`)
  )
  assert.equal(
    image.markdown,
    `[![A "launch" <hero>](${ORIGIN}/api/share/${TOKEN}/media)](${ORIGIN}/s/${TOKEN})`
  )
  const video = embedSnippets(ORIGIN, {
    altText: null,
    height: null,
    mediaType: 'video/mp4',
    title: 'Tour',
    token: TOKEN,
    width: null,
  })
  assert.match(video.html, /^<video src=".*\/media" width="1200" height="675" controls playsinline/)
  assert.equal(video.markdown, `[Tour](${ORIGIN}/s/${TOKEN})`)
})
