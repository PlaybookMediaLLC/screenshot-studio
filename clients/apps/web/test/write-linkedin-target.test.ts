import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linkedInPostIdentity } from '../lib/write/linkedin-target'

test('LinkedIn feed and public share links retain their native repost identity', () => {
  for (const [url, expected] of [
    ['https://www.linkedin.com/feed/update/urn:li:share:123/?utm=copy', 'urn:li:share:123'],
    ['https://linkedin.com/feed/update/urn%3Ali%3AugcPost%3A456', 'urn:li:ugcPost:456'],
    [
      'https://www.linkedin.com/posts/anne_release-notes-activity-789-Ab_c?utm_source=share',
      'urn:li:activity:789',
    ],
  ])
    assert.equal(linkedInPostIdentity(url), expected)
  for (const url of [
    'https://evil.test/feed/update/urn:li:share:123',
    'https://linkedin.com.evil.test/feed/update/urn:li:share:123',
    'https://linkedin.com/?url=urn:li:share:123',
    'https://linkedin.com/company/urn:li:share:123',
    'https://linkedin.com/feed/update/urn:li:share:123junk',
    'https://linkedin.com/posts/anne-activity-invalid',
  ])
    assert.equal(linkedInPostIdentity(url), null)
})
