import assert from 'node:assert/strict'
import test from 'node:test'
import { githubChoicesParamSchema } from '../lib/tenant/github-choices'

test('installation choices parse from the settings URL and reject anything else', () => {
  assert.deepEqual(githubChoicesParamSchema.parse('7:acme,9:octo-cat'), [
    { accountLogin: 'acme', id: 7 },
    { accountLogin: 'octo-cat', id: 9 },
  ])
  for (const value of [
    '',
    '7:acme',
    '7:acme,0:zero',
    '7:acme,x:octocat',
    '7:acme,9:<script>',
    '7:acme,9:-dash',
    '7:acme,9:',
    `${Array.from({ length: 101 }, (_, i) => `${i + 1}:a`).join(',')}`,
  ]) {
    assert.equal(githubChoicesParamSchema.safeParse(value).success, false, value)
  }
})
