import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { zoomed } = createRequire(__filename)('../postcss-app-zoom.cjs') as {
  zoomed: (value: string) => string
}

test('pixel lengths follow the app zoom; hairlines, strings and other units do not', () => {
  const z = (px: string) => `calc(${px} * var(--app-zoom, 1))`
  assert.equal(zoomed('16px'), z('16px'))
  assert.equal(zoomed('-4px'), z('-4px'))
  assert.equal(zoomed('0 1px 2px rgb(0 0 0 / 0.1)'), `0 1px ${z('2px')} rgb(0 0 0 / 0.1)`)
  assert.equal(zoomed('calc(100vh - 16px)'), `calc(100vh - ${z('16px')})`)
  assert.equal(zoomed('translate(-50%, 12px)'), `translate(-50%, ${z('12px')})`)
  assert.equal(zoomed('1px solid'), '1px solid')
  assert.equal(zoomed('0px'), '0px')
  assert.equal(zoomed('1.25rem 100vh 50%'), '1.25rem 100vh 50%')
})
