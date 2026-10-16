import assert from 'node:assert/strict'
import test from 'node:test'
import {
  brandDesignChanges,
  brandFontId,
  parseBrandKit,
  prohibitedTermList,
} from '@/lib/launch/brand'
import { brandKitDefinitionSchema } from '@/lib/tenant/schemas'

const logoAssetId = '4b0e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b'

test('a strict brand kit definition parses and defaults its schema version', () => {
  const definition = brandKitDefinitionSchema.parse({
    colors: { accent: '#7C3AED', background: '#0B1020', text: '#FFFFFF' },
    logo: { primaryAssetId: logoAssetId },
    typography: { bodyFamily: 'inter', headingFamily: 'plus-jakarta-sans' },
  })
  assert.equal(definition.schemaVersion, 1)
  assert.deepEqual(definition.colors, { accent: '#7C3AED', background: '#0B1020', text: '#FFFFFF' })
})

test('legacy colors.foreground is saved as colors.text', () => {
  const definition = brandKitDefinitionSchema.parse({
    colors: { accent: '#7c3aed', background: '#0b1020', foreground: '#ffffff' },
    schemaVersion: 1,
    typography: { headingFamily: 'inter' },
  })
  assert.deepEqual(definition.colors, { accent: '#7c3aed', background: '#0b1020', text: '#ffffff' })
})

test('brand kit definitions reject bad hex, unknown fonts, and non-uuid logos', () => {
  const valid = {
    colors: { accent: '#7c3aed', background: '#0b1020', text: '#ffffff' },
    typography: { headingFamily: 'inter' },
  }
  for (const definition of [
    { ...valid, colors: { ...valid.colors, text: '#fff' } },
    { ...valid, colors: { ...valid.colors, background: 'blue' } },
    { ...valid, typography: { headingFamily: 'Comic Sans' } },
    { ...valid, typography: { headingFamily: 'https://fonts.example/evil.woff2' } },
    { ...valid, logo: { primaryAssetId: 'logo.png' } },
    { ...valid, schemaVersion: 2 },
  ]) {
    assert.equal(brandKitDefinitionSchema.safeParse(definition).success, false)
  }
})

test('parseBrandKit reads the strict shape, including the logo', () => {
  const kit = parseBrandKit('Launch', {
    colors: { accent: '#7C3AED', background: '#0B1020', text: '#FFFFFF' },
    logo: { primaryAssetId: logoAssetId },
    schemaVersion: 1,
    typography: { headingFamily: 'space-grotesk' },
  })
  assert.ok(kit)
  assert.equal(kit.foreground, '#ffffff')
  assert.equal(kit.logoAssetId, logoAssetId)
  assert.equal(brandFontId(kit.fontFamily), 'space-grotesk')
  assert.deepEqual(brandDesignChanges(kit, [{ text: 'Hi' }]).texts?.[0], {
    color: '#ffffff',
    fontFamily: 'space-grotesk',
    text: 'Hi',
  })
})

test('parseBrandKit still reads legacy kits', () => {
  const kit = parseBrandKit('Legacy', {
    colors: { accent: '#7C3AED', background: '#0B1020', foreground: '#FFFFFF' },
    typography: { fontFamily: 'Plus Jakarta Sans' },
  })
  assert.ok(kit)
  assert.equal(kit.foreground, '#ffffff')
  assert.equal(kit.logoAssetId, null)
  assert.equal(brandFontId(kit.fontFamily), 'plus-jakarta-sans')
})

test('prohibited terms read as strings from either stored shape', () => {
  assert.deepEqual(
    prohibitedTermList([
      'cheap',
      { term: 'guaranteed', reason: 'legal', matchMode: 'word' },
      { nope: 1 },
      '  ',
    ]),
    ['cheap', 'guaranteed']
  )
  assert.deepEqual(prohibitedTermList(undefined), [])
})
