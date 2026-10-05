import assert from 'node:assert/strict'
import test from 'node:test'
import { isKnownBackground } from '@/lib/design/catalog'
import {
  DESIGN_DOCUMENT_VERSION,
  definedChanges,
  designChangesSchema,
  designDocumentSchema,
  getDesignAssetIds,
  patchDesignDocument,
} from '@/lib/design/document'
import { designTemplates, fitFontSize, getDesignTemplate } from '@/lib/design/templates'

const screenshot = 'asset:11111111-1111-4111-8111-111111111111'
const mobile = 'asset:22222222-2222-4222-8222-222222222222'

test('every template builds a valid document with the product in it', () => {
  for (const template of designTemplates) {
    const document = template.build({ headline: 'Ship faster', screenshot, subheadline: 'Sub' })
    assert.equal(document.version, DESIGN_DOCUMENT_VERSION, template.id)
    assert.ok(getDesignAssetIds(document).includes(screenshot.slice(6)), template.id)
    assert.equal(document.texts.length > 0, template.usesCopy, template.id)
  }
})

test('phone frames show the mobile capture and laptops the desktop capture', () => {
  const document = getDesignTemplate('layout-product-suite')!.build({
    mobileScreenshot: mobile,
    screenshot,
  })
  const screens = Object.fromEntries(
    document.devices!.mockups.map((mockup) => [mockup.definitionId, mockup.screen.src])
  )
  assert.equal(screens['macbook-pro-studio-front'], screenshot)
  assert.equal(screens['iphone-17-pro-front'], mobile)
})

test('patches merge objects, replace lists, and are re-validated', () => {
  const base = getDesignTemplate('layout-headline-spotlight')!.build({
    headline: 'One',
    screenshot,
  })
  const patched = patchDesignDocument(base, {
    background: { type: 'gradient', value: 'mesh:mesh_ocean' },
    image: { perspective: { rotateY: 12 } },
    texts: [],
  })
  assert.equal(patched.background?.value, 'mesh:mesh_ocean')
  assert.equal(patched.image.perspective?.rotateY, 12)
  assert.equal(patched.image.src, screenshot, 'untouched fields survive')
  assert.equal(patched.template, base.template)
  assert.deepEqual(patched.texts, [])
  assert.throws(() =>
    patchDesignDocument(base, { background: { type: 'gradient', value: 'made-up-gradient' } })
  )
  assert.throws(() => patchDesignDocument(base, { image: { src: 'https://evil.example/x.png' } }))
})

test('documents only reference catalog options or workspace assets', () => {
  assert.equal(isKnownBackground('gradient', 'mesh:mesh_aurora'), true)
  assert.equal(isKnownBackground('solid', '#112233'), true)
  assert.equal(isKnownBackground('image', 'backgrounds/raycast/red_distortion_4.webp'), true)
  assert.equal(isKnownBackground('image', 'https://example.com/a.png'), false)
  const parsed = designDocumentSchema.safeParse({
    image: { src: screenshot },
    overlays: [{ position: { x: 0.5, y: 0.5 }, size: 0.1, src: '/etc/passwd' }],
    version: 1,
  })
  assert.equal(parsed.success, false)
})

test('headlines are sized to fit on one line', () => {
  assert.equal(fitFontSize('Short', 0.05), 0.05)
  const long = 'A very long headline that would never fit on one line at a large size'
  assert.ok(fitFontSize(long, 0.08) * long.length * 0.55 <= 0.9 + 1e-9)
})

test('a change set leaves omitted fields alone instead of resetting them to defaults', () => {
  const base = getDesignTemplate('layout-browser-launch')!.build({
    headline: 'Keep me',
    screenshot,
  })
  const changes = designChangesSchema.parse({
    background: { type: 'gradient', value: 'mesh:mesh_ocean' },
  })
  const patched = patchDesignDocument(base, definedChanges(changes))
  assert.equal(patched.image.src, screenshot)
  assert.equal(patched.texts[0]?.text, 'Keep me')
  assert.equal(patched.background?.value, 'mesh:mesh_ocean')
  const tilted = patchDesignDocument(
    base,
    definedChanges(designChangesSchema.parse({ image: { perspective: { rotateY: 10 } } }))
  )
  assert.equal(tilted.image.src, screenshot)
  assert.equal(tilted.image.frame?.type, 'macos-dark')
})
