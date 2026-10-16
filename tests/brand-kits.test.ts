import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBrandKit,
  BRAND_CATEGORIES,
  BRAND_LOGO_ID,
  pickLogo,
  readableOn,
} from '@/lib/brand/apply'
import {
  brandKitDefinition,
  brandKitLibrary,
  fontIdForName,
  readBrandKit,
  type StoredBrandKit,
} from '@/lib/brand/kit'
import { parseDesignDocument } from '@/lib/design/document'

const LOGO_LIGHT = 'asset:1b4e28ba-2fa1-11d2-883f-0016d3cca427'
const LOGO_DARK = 'asset:2c4e28ba-2fa1-11d2-883f-0016d3cca427'

const stored = (
  definition: Record<string, unknown>,
  extra: Partial<StoredBrandKit> = {}
): StoredBrandKit => ({
  definition,
  id: 'ckkit000000000000000000001',
  name: 'Acme',
  status: 'ACTIVE',
  version: 1,
  ...extra,
})

const kit = readBrandKit(
  stored(
    brandKitDefinition({
      colors: {
        accent: '#FF5A1F',
        background: '#0B1020',
        foreground: '#F8FAFC',
        secondary: '#7C3AED',
      },
      fonts: { primary: 'google:Sora', secondary: 'inter' },
      logos: [
        { id: 'l1', name: 'Light', src: LOGO_LIGHT, tone: 'light' },
        { id: 'l2', name: 'Dark', src: LOGO_DARK, tone: 'dark' },
      ],
    })
  )
)!

const design = () =>
  parseDesignDocument({
    version: 2,
    annotations: [{ end: { x: 0.5, y: 0.5 }, id: 'a1', start: { x: 0.1, y: 0.1 }, type: 'arrow' }],
    elements: [
      {
        height: 0.06,
        id: 'badge-1',
        props: {
          background: '#000000',
          borderColor: '#ffffff',
          borderWidth: 0,
          color: '#ffffff',
          fontScale: 0.5,
          number: 1,
          numbering: 'numeric',
          shadow: { blur: 0, color: '#000000', enabled: false, offsetX: 0, offsetY: 0 },
          shape: 'circle',
        },
        type: 'badge',
        width: 0.06,
        x: 0.2,
        y: 0.2,
      },
    ],
    image: { src: null },
    texts: [
      { fontSize: 0.06, id: 'h', position: { x: 50, y: 10 }, text: 'Headline' },
      {
        fill: { angle: 45, from: '#000000', kind: 'gradient', to: '#ffffff' },
        fontSize: 0.03,
        id: 's',
        position: { x: 50, y: 20 },
        text: 'Sub',
      },
    ],
  })

test('older kits (colours and a typeface name) still read', () => {
  const legacy = readBrandKit(
    stored({
      colors: { accent: '#6d5dfc', background: '#ffffff', foreground: '#111111' },
      typography: { fontFamily: 'Bricolage Grotesque' },
    })
  )
  assert.equal(legacy?.accent, '#6d5dfc')
  assert.equal(legacy?.primaryFont, 'google:Bricolage Grotesque')
  assert.equal(legacy?.secondaryFont, 'google:Bricolage Grotesque')
  assert.deepEqual(legacy?.logos, [])
  assert.equal(
    readBrandKit(stored({ accent: '#7047eb' })),
    null,
    'a kit without colours is not shown'
  )
  assert.equal(fontIdForName('Montserrat'), 'montserrat', 'a catalog font wins')
  assert.equal(fontIdForName('Inter'), 'inter')
  assert.equal(fontIdForName('"Inter", sans-serif'), 'inter')
})

test('a stored definition keeps the primary font name for older readers', () => {
  const definition = brandKitDefinition({
    colors: { background: '#ffffff', foreground: '#111111' },
    fonts: { primary: 'google:Plus Jakarta Sans' },
  })
  assert.equal(definition.typography.fontFamily, 'Plus Jakarta Sans')
  assert.throws(() => brandKitDefinition({ colors: { background: 'red', foreground: '#111111' } }))
})

test('the library shows the latest active version of each kit', () => {
  const library = brandKitLibrary([
    stored({ colors: { background: '#ffffff', foreground: '#000000' } }, { id: 'a1', version: 1 }),
    stored({ colors: { background: '#000000', foreground: '#ffffff' } }, { id: 'a2', version: 2 }),
    stored(
      { colors: { background: '#000000', foreground: '#ffffff' } },
      { id: 'b1', name: 'Gone', status: 'ARCHIVED' }
    ),
  ])
  assert.deepEqual(
    library.map((entry) => [entry.name, entry.id]),
    [['Acme', 'a2']]
  )
})

test('applying a kit sets colours, fonts, background, and a logo', () => {
  const { binding, document } = applyBrandKit(design(), kit, BRAND_CATEGORIES)
  assert.equal(document.texts[0]?.color, '#f8fafc')
  assert.equal(document.texts[0]?.fontFamily, 'google:Sora', 'the headline gets the primary font')
  assert.equal(document.texts[1]?.fontFamily, 'inter', 'other text gets the secondary font')
  assert.deepEqual(document.texts[1]?.fill, {
    angle: 45,
    from: '#ff5a1f',
    kind: 'gradient',
    to: '#7c3aed',
  })
  assert.equal(document.annotations[0]?.strokeColor, '#ff5a1f')
  const badge = document.elements[0]
  assert.equal(badge?.type === 'badge' && badge.props.background, '#ff5a1f')
  assert.equal(badge?.type === 'badge' && badge.props.color, readableOn('#ff5a1f'))
  assert.match(document.background?.value ?? '', /#0b1020.*#ff5a1f/)
  const logo = document.overlays.find((overlay) => overlay.id === BRAND_LOGO_ID)
  assert.equal(logo?.src, LOGO_LIGHT, 'a light logo on a dark brand background')
  assert.equal(binding.kitId, kit.id)
  assert.equal(binding.applied['texts.h.color'], '#f8fafc')
})

test('only the chosen categories change', () => {
  const before = design()
  const { document } = applyBrandKit(before, kit, ['typography'])
  assert.equal(document.texts[0]?.fontFamily, 'google:Sora')
  assert.equal(document.texts[0]?.color, before.texts[0]?.color)
  assert.deepEqual(document.background, before.background)
  assert.equal(document.overlays.length, 0)
})

test('applying again keeps what the user changed, unless overrides are reset', () => {
  const first = applyBrandKit(design(), kit, BRAND_CATEGORIES)
  // The user recolours the headline and moves the logo.
  const edited = structuredClone(first.document)
  edited.texts[0]!.color = '#00ff00'
  const logo = edited.overlays.find((overlay) => overlay.id === BRAND_LOGO_ID)!
  logo.position = { x: 0.1, y: 0.1 }

  const newer = { ...kit, colors: { ...kit.colors, foreground: '#e2e8f0' }, version: 2 }
  const second = applyBrandKit(edited, newer, BRAND_CATEGORIES, { binding: first.binding })
  assert.equal(second.document.texts[0]?.color, '#00ff00', 'the override is kept')
  assert.equal(second.document.texts[1]?.color, '#e2e8f0', 'untouched properties follow the kit')
  assert.deepEqual(second.keptOverrides, ['texts.h.color'])
  assert.deepEqual(
    second.document.overlays.find((overlay) => overlay.id === BRAND_LOGO_ID)?.position,
    { x: 0.1, y: 0.1 },
    'the logo keeps its place'
  )

  const reset = applyBrandKit(edited, newer, BRAND_CATEGORIES, {
    binding: first.binding,
    resetOverrides: true,
  })
  assert.equal(reset.document.texts[0]?.color, '#e2e8f0')
  assert.deepEqual(reset.keptOverrides, [])
})

test('logos are picked by tone', () => {
  assert.equal(pickLogo(kit.logos, true)?.src, LOGO_LIGHT)
  assert.equal(pickLogo(kit.logos, false)?.src, LOGO_DARK)
  assert.equal(
    pickLogo([{ id: 'x', name: 'Any', src: LOGO_DARK, tone: 'any' }], true)?.src,
    LOGO_DARK
  )
})
