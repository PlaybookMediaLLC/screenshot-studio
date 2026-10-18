import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { test } from 'node:test'
import JSZip from 'jszip'
import {
  frameAt,
  frameCount,
  slideDurations,
  totalDuration,
} from '../lib/store-screenshots/animation/timeline'
import { applyBrandKit, brandKitFromDocument } from '../lib/store-screenshots/brand-kits'
import {
  countIssues,
  localeIssues,
  targetRequirementIssues,
} from '../lib/store-screenshots/compliance'
import {
  createStarterDocument,
  DEFAULT_ANIMATION,
  hashRichText,
} from '../lib/store-screenshots/document/factory'
import type { StoreDocument, TextLayer } from '../lib/store-screenshots/document/schema'
import { ExportCancelledError, runExportJob, zipOutputs } from '../lib/store-screenshots/export/job'
import { planExport, type ExportSettings } from '../lib/store-screenshots/export/plan'
import { encodeRgbPng, readPngHeader } from '../lib/store-screenshots/export/png'
import {
  decodeSpans,
  encodeSpans,
  localeStatus,
  pendingTranslations,
} from '../lib/store-screenshots/localization'
import { applyTemplateToDocument, BUILT_IN_TEMPLATES } from '../lib/store-screenshots/templates'
import { parseFigmaFileUrl } from '../lib/integrations/figma-url'

const settings = (
  document: StoreDocument,
  patch: Partial<ExportSettings> = {}
): ExportSettings => ({
  targets: [{ targetId: 'ios-iphone-6.9', sizeIndex: 0, orientation: 'portrait' }],
  format: 'png',
  quality: 0.9,
  locales: ['en-US'],
  slideIds: document.slides.map((slide) => slide.id),
  folderLayout: 'store-locale-device',
  packaging: 'zip',
  prefix: '',
  ...patch,
})

const headingOf = (document: StoreDocument, index = 0) =>
  document.slides[index].layers.find((layer): layer is TextLayer => layer.type === 'text')!

test('export plan: one file per target × locale × slide, numbered in project order with exact sizes', () => {
  const document = createStarterDocument()
  const files = planExport(
    document,
    settings(document, {
      targets: [
        { targetId: 'ios-iphone-6.9', sizeIndex: 0, orientation: 'portrait' },
        { targetId: 'play-phone', sizeIndex: 0, orientation: 'portrait' },
      ],
      locales: ['en-US', 'de-DE'],
      prefix: 'My App',
    })
  )
  assert.equal(files.length, 2 * 2 * document.slides.length)
  assert.match(
    files[0].path,
    /^app-store\/en-US\/iphone-6\.9in\/my-app_01_[a-z0-9-]+_1320x2868\.png$/
  )
  assert.ok(files.some((file) => file.path.startsWith('google-play/de-DE/phone/')))
  assert.equal(new Set(files.map((file) => file.path)).size, files.length, 'paths are unique')
  const flat = planExport(document, settings(document, { folderLayout: 'flat', format: 'jpeg' }))
  assert.ok(flat.every((file) => !file.path.includes('/') && file.path.endsWith('.jpg')))
  assert.equal(new Set(flat.map((file) => file.path)).size, flat.length)
  const subset = planExport(document, settings(document, { slideIds: [document.slides[2].id] }))
  assert.equal(subset.length, 1)
  assert.equal(subset[0].slideIndex, 2)
  assert.equal(subset[0].position, 1)
})

test('PNG encoder writes opaque 8-bit RGB with transparency composited onto white', async () => {
  const width = 3
  const height = 2
  const rgba = new Uint8ClampedArray(width * height * 4)
  rgba.set([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128])
  rgba.fill(40, 12)
  for (let index = 15; index < rgba.length; index += 4) rgba[index] = 255
  const png = await encodeRgbPng(rgba, width, height)
  assert.deepEqual(readPngHeader(png), { width, height, colorType: 2, bitDepth: 8 })
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = new DataView(png.buffer, png.byteOffset + offset).getUint32(0)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    if (type === 'IDAT') chunks.push(Buffer.from(png.subarray(offset + 8, offset + 8 + length)))
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  assert.equal(raw.length, (width * 3 + 1) * height)
  // First row uses the Sub filter: bytes are deltas from the pixel to the left.
  const row = [raw[1], raw[2], raw[3]]
  const second = [(raw[4] + row[0]) & 255, (raw[5] + row[1]) & 255, (raw[6] + row[2]) & 255]
  const third = [(raw[7] + second[0]) & 255, (raw[8] + second[1]) & 255, (raw[9] + second[2]) & 255]
  assert.deepEqual(row, [255, 0, 0])
  assert.deepEqual(second, [255, 255, 255], 'transparent becomes the white matte, not black')
  assert.deepEqual(third, [127, 127, 255], 'half-transparent blue blends with white')
})

test('export job reports oversize files, keeps going after failures, and cancels between files', async () => {
  const document = createStarterDocument()
  const files = planExport(
    document,
    settings(document, {
      targets: [{ targetId: 'play-phone', sizeIndex: 0, orientation: 'portrait' }],
    })
  )
  const result = await runExportJob(
    files,
    async (file) => {
      if (file.position === 2) throw new Error('boom')
      return new Blob([new Uint8Array(file.position === 3 ? 9 * 1024 * 1024 : 10)])
    },
    { signal: new AbortController().signal }
  )
  assert.equal(result.outputs.length, files.length - 2)
  assert.deepEqual(
    result.failures.map((failure) => failure.file.position),
    [2, 3]
  )
  assert.match(result.failures[1].reason, /over the 8 MB limit/)

  const zip = await JSZip.loadAsync(
    await (await zipOutputs(result.outputs, new AbortController().signal)).arrayBuffer()
  )
  assert.deepEqual(
    Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir)
      .sort(),
    result.outputs.map((output) => output.file.path).sort()
  )

  const controller = new AbortController()
  let rendered = 0
  await assert.rejects(
    runExportJob(
      files,
      async () => {
        rendered += 1
        if (rendered === 2) controller.abort()
        return new Blob(['x'])
      },
      { signal: controller.signal }
    ),
    ExportCancelledError
  )
  assert.equal(rendered, 2)
})

test('store requirements: counts, formats, and required sets are requirements, not suggestions', () => {
  const one = targetRequirementIssues({
    targets: [{ targetId: 'play-phone', sizeIndex: 0, orientation: 'portrait' }],
    format: 'png',
    locales: ['en-US'],
    slideIds: ['a'],
  })
  assert.ok(one.some((issue) => issue.code === 'too-few' && issue.severity === 'requirement'))
  const iphone = targetRequirementIssues({
    targets: [{ targetId: 'ios-iphone-6.9', sizeIndex: 0, orientation: 'portrait' }],
    format: 'png',
    locales: ['en-US'],
    slideIds: ['a', 'b', 'c'],
  })
  assert.deepEqual(
    iphone.map((issue) => issue.code),
    ['required-target']
  )
  const eleven = targetRequirementIssues({
    targets: [{ targetId: 'ios-iphone-6.3', sizeIndex: 0, orientation: 'portrait' }],
    format: 'png',
    locales: ['en-US'],
    slideIds: Array.from({ length: 11 }, (_, index) => String(index)),
  })
  assert.deepEqual(
    eleven.map((issue) => issue.code),
    ['too-many']
  )
  assert.deepEqual(countIssues([...one, ...iphone]), {
    requirements: one.length + iphone.length,
    recommendations: 0,
  })
})

test('localization: missing and outdated translations are reported and queued, approved current ones are kept', () => {
  const document = createStarterDocument()
  document.localization.locales = ['de-DE']
  const heading = headingOf(document)
  const sub = headingOf(document, 1)
  heading.translations['de-DE'] = {
    content: [{ text: 'Hallo' }],
    status: 'approved',
    sourceHash: hashRichText(heading.content),
    updatedAt: 1,
  }
  sub.translations['de-DE'] = {
    content: [{ text: 'Alt' }],
    status: 'approved',
    sourceHash: 'stale',
    updatedAt: 1,
  }
  const status = localeStatus(document, 'de-DE')
  assert.equal(status.approved, 2)
  assert.equal(status.outdated, 1)
  assert.equal(status.missing, status.total - 2)
  const pending = pendingTranslations(document, ['de-DE'])
  assert.ok(
    !pending.some((request) => request.layerId === heading.id),
    'approved and current is left alone'
  )
  assert.ok(
    pending.some((request) => request.layerId === sub.id),
    'approved but outdated is redone'
  )
  assert.ok(
    pendingTranslations(document, ['de-DE'], { includeApproved: true }).some(
      (request) => request.layerId === heading.id
    )
  )
  const issues = localeIssues(document, {
    targets: [],
    format: 'png',
    locales: ['en-US', 'de-DE'],
    slideIds: document.slides.slice(0, 2).map((slide) => slide.id),
  })
  assert.equal(
    issues.find((issue) => issue.layerId === heading.id),
    undefined
  )
  assert.equal(issues.find((issue) => issue.layerId === sub.id)?.code, 'translation-outdated')
  assert.ok(
    issues.every((issue) => issue.locale === 'de-DE' && issue.severity === 'recommendation')
  )
})

test('rich text survives translation round trips through numbered tags', () => {
  const source = [{ text: 'Track ' }, { text: 'every', bold: true }, { text: ' habit' }]
  const encoded = encodeSpans(source)
  assert.equal(encoded, 'Track <1>every</1> habit')
  assert.deepEqual(decodeSpans('Verfolge <1>jede</1> Gewohnheit', source), [
    { text: 'Verfolge ' },
    { text: 'jede', bold: true },
    { text: ' Gewohnheit' },
  ])
})

test('templates restyle the project but keep copy and screenshots', () => {
  const document = createStarterDocument()
  const template = BUILT_IN_TEMPLATES[1]
  const styled = applyTemplateToDocument(document, template)
  assert.equal(styled.templateId, template.id)
  assert.deepEqual(
    styled.slides.map((slide) => slide.id),
    document.slides.map((slide) => slide.id)
  )
  assert.deepEqual(headingOf(styled).content, headingOf(document).content)
  const screens = (doc: StoreDocument) =>
    doc.slides.flatMap((slide) =>
      slide.layers.flatMap((layer) => (layer.type === 'device' ? [layer.assetId] : []))
    )
  assert.deepEqual(screens(styled), screens(document))
  assert.equal(styled.slides[0].layout, template.slides[0].layout)
})

test('brand kits apply to selected slides only, and project-wide through the theme', () => {
  const source = createStarterDocument()
  source.theme.palette = ['#112233', '#445566']
  source.theme.textStyles.heading.fontFamily = 'Inter'
  const kit = brandKitFromDocument(source, 'Acme')
  const target = createStarterDocument()
  headingOf(target, 1).style = { fontFamily: 'Georgia', color: '#ff0000' }
  const parts = {
    colors: true,
    fonts: true,
    background: false,
    device: false,
    logo: false,
    keepOverrides: false,
  }
  const selected = applyBrandKit(target, kit, [target.slides[0].id], parts)
  assert.equal(headingOf(selected, 0).style.fontFamily, 'Inter')
  assert.equal(
    headingOf(selected, 1).style.fontFamily,
    'Georgia',
    'unselected slides are untouched'
  )
  const colorsOnly = applyBrandKit(target, kit, null, { ...parts, fonts: false })
  assert.deepEqual(colorsOnly.theme.palette, ['#112233', '#445566'])
  assert.equal(
    headingOf(colorsOnly, 1).style.fontFamily,
    'Georgia',
    'a colors-only kit keeps font overrides'
  )
  assert.equal(headingOf(colorsOnly, 1).style.color, undefined)
})

test('animation timeline: durations add up and transitions blend neighbouring slides', () => {
  const document = createStarterDocument()
  const ids = document.slides.slice(0, 3).map((slide) => slide.id)
  const durations = slideDurations(
    { ...document, animation: { ...DEFAULT_ANIMATION, slideDurations: { [ids[1]]: 4 } } },
    ids
  )
  assert.deepEqual(durations, [2.5, 4, 2.5])
  assert.equal(totalDuration(durations), 9)
  assert.equal(frameCount(durations, 30), 270)
  const settled = frameAt(DEFAULT_ANIMATION, durations, 1.5)
  assert.equal(settled.slides.length, 1)
  assert.equal(settled.slides[0].slideIndex, 0)
  const mid = frameAt(DEFAULT_ANIMATION, durations, 2.25)
  assert.deepEqual(
    mid.slides.map((slide) => slide.slideIndex),
    [0, 1]
  )
  assert.ok(mid.slides[1].slide.dx > 0 && mid.slides[1].slide.dx < 1)
  assert.equal(frameAt(DEFAULT_ANIMATION, durations, 99).slides[0].slideIndex, 2)
})

test('Figma links: only https figma.com file links are accepted', () => {
  assert.deepEqual(
    parseFigmaFileUrl('https://www.figma.com/design/AbCdEfGhIjKl123/App?node-id=12-34'),
    { fileKey: 'AbCdEfGhIjKl123', nodeId: '12:34' }
  )
  assert.equal(parseFigmaFileUrl('http://www.figma.com/file/AbCdEfGhIjKl123/App'), null)
  assert.equal(parseFigmaFileUrl('https://evil.example/file/AbCdEfGhIjKl123'), null)
  assert.equal(parseFigmaFileUrl('https://figma.com.evil.example/file/AbCdEfGhIjKl123'), null)
  assert.equal(parseFigmaFileUrl('not a url'), null)
})
