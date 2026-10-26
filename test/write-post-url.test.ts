import assert from 'node:assert/strict'
import test from 'node:test'
import { nativePostURL } from '../lib/write/post-url'

test('native post URL recognition preserves the provider target and refuses lookalikes', () => {
  for (const [url, channel] of [
    ['https://x.com/author/status/123?s=20', 'x'],
    ['https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123/', 'linkedin'],
    ['https://bsky.app/profile/example.bsky.social/post/abc123', 'bluesky'],
    ['https://mastodon.social/@author/123', 'mastodon'],
  ])
    assert.deepEqual(nativePostURL(url), { url, channel })
  for (const url of [
    'https://x.com.evil.test/name/status/123',
    'https://x.com@evil.test/name/status/123',
    'http://x.com/name/status/123',
    'javascript:alert(1)',
    'https://bsky.app/profile/name',
    'Words https://x.com/name/status/123',
    'https://linkedin.com/feed/update/%XX',
    'https://x.com:8443/name/status/123',
  ])
    assert.equal(nativePostURL(url), null)
})
