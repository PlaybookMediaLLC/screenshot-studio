import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDesignDocument } from '@/lib/design/document'
import {
  applyPresetTo,
  copyName,
  type CreativeTemplate,
  presetDefinition,
  presetFromDocument,
  presetLibrary,
} from '@/lib/presets/preset'

const design = parseDesignDocument({
  version: 2,
  background: { type: 'solid', value: '#101828' },
  devices: {
    mockups: [
      {
        definitionId: 'iphone-17-pro-front',
        position: { x: 0.3, y: 0.5 },
        screen: { src: 'asset:1b4e28ba-2fa1-11d2-883f-0016d3cca427' },
        size: 0.4,
      },
    ],
  },
  image: { name: 'project.png', radius: 18, src: 'asset:2c4e28ba-2fa1-11d2-883f-0016d3cca427' },
  overlays: [
    { position: { x: 0.9, y: 0.9 }, size: 0.1, src: 'asset:3d4e28ba-2fa1-11d2-883f-0016d3cca427' },
  ],
  redactions: [{ position: { x: 0.1, y: 0.1 }, size: { height: 0.1, width: 0.2 } }],
  slides: { items: [{ duration: 2, id: 's1', src: 'asset:2c4e28ba-2fa1-11d2-883f-0016d3cca427' }] },
  texts: [{ fontSize: 0.05, position: { x: 50, y: 10 }, text: 'Ship faster' }],
})

test('a preset keeps the look and drops the project screenshots', () => {
  const preset = presetFromDocument(design)
  assert.equal(preset.image.src, null)
  assert.equal(preset.image.name, undefined)
  assert.equal(preset.image.radius, 18)
  assert.equal(preset.slides, undefined)
  assert.deepEqual(preset.redactions, [])
  assert.equal(preset.devices?.mockups[0]?.screen.src, null)
  assert.equal(
    preset.overlays[0]?.src,
    design.overlays[0]?.src,
    'logos and stickers are part of the look'
  )
  assert.deepEqual(preset.background, design.background)
  assert.equal(preset.texts[0]?.text, 'Ship faster')
  // A stored preset parses back as a document.
  assert.deepEqual(
    parseDesignDocument(JSON.parse(JSON.stringify(presetDefinition(design).document))),
    preset
  )
})

test('applying a preset keeps the project screenshot, screens, slides, and blur regions', () => {
  const other = parseDesignDocument({
    version: 2,
    background: { type: 'solid', value: '#ffffff' },
    image: { name: 'other.png', src: 'blob:http://localhost/other' },
    texts: [],
  })
  const applied = applyPresetTo(presetFromDocument(design), other)
  assert.equal(applied.image.src, 'blob:http://localhost/other')
  assert.equal(applied.image.name, 'other.png')
  assert.equal(applied.image.radius, 18)
  assert.deepEqual(applied.background, design.background)
  assert.equal(
    applied.devices?.mockups[0]?.screen.src,
    null,
    'the device reuses the main screenshot'
  )
  assert.deepEqual(applied.redactions, [])
  assert.equal(applied.texts[0]?.text, 'Ship faster')

  const withScreen = applyPresetTo(presetFromDocument(design), design)
  assert.equal(withScreen.devices?.mockups[0]?.screen.src, design.devices?.mockups[0]?.screen.src)
  assert.deepEqual(withScreen.slides, design.slides)
})

test('the library lists the latest active version of each preset', () => {
  const definition = presetDefinition(design)
  const template = (
    name: string,
    version: number,
    extra: Partial<CreativeTemplate> = {}
  ): CreativeTemplate => ({
    createdAt: new Date(2026, 9, version),
    definition,
    id: `${name}-${version}`,
    name,
    status: 'ACTIVE',
    version,
    ...extra,
  })
  const library = presetLibrary([
    template('Hero', 1),
    template('Hero', 2),
    template('Old', 1, { status: 'ARCHIVED' }),
    template('Campaign', 1, { definition: { layout: 'social' } }),
    template('Broken', 1, { definition: { document: { version: 99 }, kind: 'design-preset' } }),
  ])
  assert.deepEqual(
    library.map((preset) => [preset.name, preset.version]),
    [['Hero', 2]]
  )
})

test('copy names never collide', () => {
  assert.equal(copyName('Hero', new Set()), 'Hero copy')
  assert.equal(copyName('Hero', new Set(['Hero copy'])), 'Hero copy 2')
  assert.equal(copyName('Hero', new Set(['Hero copy', 'Hero copy 2'])), 'Hero copy 3')
  assert.ok(copyName('x'.repeat(100), new Set()).length <= 100)
})

test('a preset leaves out alt text, captions, the brand binding, audio, and the caption track', () => {
  const project = parseDesignDocument({
    version: 2,
    brand: { applied: {}, kitId: 'ckkit', name: 'Acme', version: 1 },
    copy: { altText: 'Project A dashboard', captions: { x: 'A' } },
    image: { src: 'blob:http://localhost/a' },
    timeline: {
      audio: [],
      clips: [
        {
          color: '#fff',
          duration: 1000,
          id: 'c1',
          name: 'Fade',
          presetId: 'fade-in',
          startTime: 0,
        },
      ],
      duration: 4000,
      tracks: [],
    },
  })
  const preset = presetFromDocument(project)
  assert.equal(preset.copy, undefined)
  assert.equal(preset.brand, undefined)
  assert.equal(preset.timeline?.clips.length, 1, 'motion stays')
  assert.equal(preset.timeline?.audio, undefined)
  const other = parseDesignDocument({
    version: 2,
    copy: { altText: 'Project B', captions: {} },
    image: { src: 'blob:http://localhost/b' },
  })
  const applied = applyPresetTo(preset, other)
  assert.equal(applied.copy?.altText, 'Project B')
  assert.equal(applied.brand, undefined)
  assert.equal(applied.timeline?.clips.length, 1)
})
