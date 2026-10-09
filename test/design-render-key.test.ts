import assert from 'node:assert/strict'
import test from 'node:test'
import { designRenderKey } from '@/lib/design/render-key'
import { getDesignTemplate } from '@/lib/design/templates'

const screenshot = 'asset:11111111-1111-4111-8111-111111111111'
const document = getDesignTemplate('layout-headline-spotlight')!.build({
  headline: 'Hi',
  screenshot,
})
const assets = { '11111111-1111-4111-8111-111111111111': 'a'.repeat(64) }
const png = { format: 'png', scale: 2 }

test('equivalent documents share a render key regardless of key order', () => {
  const reordered = JSON.parse(JSON.stringify(document, Object.keys(document).sort().reverse()))
  assert.equal(
    designRenderKey({ assets, document, options: png }),
    designRenderKey({ assets, document: { ...reordered, ...document }, options: png })
  )
})

test('any change to pixels-relevant input changes the key', () => {
  const base = designRenderKey({ assets, document, options: png })
  assert.notEqual(
    base,
    designRenderKey({ assets, document, options: { format: 'jpeg', scale: 2 } })
  )
  assert.notEqual(base, designRenderKey({ assets, document, options: { format: 'png', scale: 1 } }))
  assert.notEqual(
    base,
    designRenderKey({
      assets: { ...assets, '11111111-1111-4111-8111-111111111111': 'b'.repeat(64) },
      document,
      options: png,
    })
  )
  assert.notEqual(
    base,
    designRenderKey({ assets, document: { ...document, texts: [] }, options: png })
  )
})
