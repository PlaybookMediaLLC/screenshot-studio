import assert from 'node:assert/strict'
import test from 'node:test'
import { artboardRect, canvasDocumentSchema, type CanvasDocument } from '@/lib/canvas/document'
import {
  alternativeLayouts,
  buildRecipe,
  blankArtboard,
  canvasRecipeSchema,
  type RecipeScreenshot,
} from '@/lib/canvas/recipes'
import { blockChanges, layerBlockSchema, LAYER_LIMITS } from '@/lib/canvas/blocks'
import { brandCommand } from '@/lib/canvas/brand'
import { applyCanvasCommand } from '@/lib/canvas/commands'
import { artboardFileName, documentForExport, exportSelection } from '@/lib/canvas/export'
import { artboardFromDesign, artboardFromProject, artboardsFromStorySet } from '@/lib/canvas/import'
import { intersects } from '@/lib/canvas/viewport'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { designDocumentSchema } from '@/lib/design/document'
import { documentCanvasSize } from '@/lib/export/adapt'
import { readBrandKit } from '@/lib/brand/kit'

const fill = (color: string, aspect: number) =>
  `data:image/png;base64,${Buffer.from(`${color}:${aspect.toFixed(3)}`).toString('base64')}`
function ids() {
  let next = 0
  return () => `id-${++next}`
}
const shot: RecipeScreenshot = {
  src: 'asset:11111111-1111-4111-8111-111111111111',
  name: 'dashboard.png',
  width: 1440,
  height: 900,
}
const release = {
  id: 'rel_1',
  title: 'Approvals 2.0',
  benefitStatement: 'Approve launches from one queue.',
  features: [{ title: 'Bulk approve' }, { title: 'Slack reminders' }],
}

test('every recipe builds valid, non-overlapping artboards from nothing', () => {
  for (const recipe of canvasRecipeSchema.options) {
    const artboards = buildRecipe(recipe, {}, { newId: ids(), fill })
    assert.ok(artboards.length >= 1, recipe)
    const canvas = canvasDocumentSchema.parse({ version: 1, kind: 'canvas', artboards })
    const rects = canvas.artboards.map(artboardRect)
    for (const [index, rect] of rects.entries())
      for (const other of rects.slice(index + 1))
        assert.ok(
          !intersects({ ...rect, width: rect.width - 1 }, other),
          `${recipe} artboards overlap`
        )
    for (const artboard of canvas.artboards) {
      assert.deepEqual(artboard.origin, { kind: 'recipe', id: recipe, version: 1 })
      assert.equal(designDocumentSchema.parse(artboard.document).version, 2)
    }
  }
})

test('generated copy quotes the release record as verified and marks template wording as suggested', () => {
  const [announcement] = buildRecipe(
    'feature-announcement',
    { release, featureIndex: 1 },
    { newId: ids(), fill }
  )
  const byText = new Map(announcement!.document.texts.map((text) => [text.id, text.text]))
  const verified = announcement!.provenance.filter((claim) => claim.status === 'verified')
  const suggested = announcement!.provenance.filter((claim) => claim.status === 'suggested')
  assert.deepEqual(
    verified.map((claim) => byText.get(claim.layerId)),
    ['Slack reminders', 'Approve launches from one queue.']
  )
  assert.equal(verified[0]!.reference?.kind, 'release-feature')
  assert.ok(suggested.length >= 1, 'the template label is a suggestion')
  assert.equal(announcement!.context?.releaseId, 'rel_1')
  for (const claim of announcement!.provenance)
    assert.equal(
      claim.generated,
      byText.get(claim.layerId),
      'the generated text is recorded as generated'
    )
})

test('a person’s own words carry no provenance; missing facts stay placeholders, never invented', () => {
  const [mine] = buildRecipe(
    'feature-announcement',
    { headline: 'Ship faster', supporting: 'Less waiting.' },
    { newId: ids(), fill }
  )
  assert.deepEqual(
    mine!.provenance.map((claim) => claim.status),
    ['suggested'],
    'only the template label'
  )
  const [table] = buildRecipe('comparison', {}, { newId: ids(), fill })
  const claims = table!.document.texts.filter((text) => text.text === 'Add a sourced claim')
  assert.equal(claims.length, 8)
  assert.ok(table!.provenance.every((claim) => claim.status === 'suggested'))
  const stat = blockChanges(
    'stat',
    blankArtboard('wide-16x9', { x: 0, y: 0, newId: ids() }).document,
    { newId: ids(), fill }
  )
  assert.ok(stat.texts!.some((text) => text.text.startsWith('Source:')))
  assert.ok(!stat.texts!.some((text) => /\d+%/.test(text.text)), 'no made-up metric')
})

test('screenshot recipes reuse Story Set compositions and adapt to every channel size', () => {
  const pack = buildRecipe(
    'social-pack',
    { screenshots: [shot], headline: 'Ship' },
    { newId: ids(), fill }
  )
  assert.deepEqual(
    pack.map((artboard) => documentCanvasSize(artboard.document)),
    [
      { width: 1600, height: 900 },
      { width: 1080, height: 1080 },
      { width: 1080, height: 1350 },
      { width: 1080, height: 1920 },
    ]
  )
  for (const artboard of pack) assert.equal(artboard.document.image.src, shot.src)
  const walkthrough = buildRecipe(
    'walkthrough',
    { screenshots: [shot], steps: ['Open', 'Pick', 'Ship'] },
    { newId: ids(), fill }
  )
  assert.equal(walkthrough.length, 3)
  assert.deepEqual(
    walkthrough.map(
      (artboard) => artboard.document.elements.find((element) => element.type === 'badge')?.props
    ),
    walkthrough.map((_, index) => ({
      ...walkthrough[index]!.document.elements[0]!.props,
      number: index + 1,
    }))
  )
  const comparison = buildRecipe(
    'before-after',
    { screenshots: [shot, { ...shot, src: 'asset:22222222-2222-4222-8222-222222222222' }] },
    { newId: ids(), fill }
  )
  assert.deepEqual(
    comparison[0]!.document.devices?.mockups.map((mockup) => mockup.screen.src),
    [shot.src, 'asset:22222222-2222-4222-8222-222222222222']
  )
})

test('blocks add native layers, put filled containers behind text and respect layer limits', () => {
  const document = blankArtboard('wide-16x9', { x: 0, y: 0, newId: ids() }).document
  for (const block of layerBlockSchema.options) {
    const changes = blockChanges(block, document, { newId: ids(), fill })
    const parsed = designDocumentSchema.parse({ ...document, ...changes })
    assert.ok(
      parsed.texts.length +
        parsed.annotations.length +
        parsed.elements.length +
        parsed.overlays.length >
        1,
      block
    )
  }
  const card = blockChanges('feature-card', document, { newId: ids(), fill })
  assert.equal(card.overlays![0]!.layer, 'back', 'the card draws behind its text')
  assert.equal(card.texts!.length, document.texts.length + 2)
  const full = designDocumentSchema.parse({
    ...document,
    texts: Array.from({ length: LAYER_LIMITS.texts }, (_, index) => ({
      ...document.texts[0]!,
      id: `t${index}`,
    })),
  })
  assert.throws(
    () => blockChanges('headline', full, { newId: ids(), fill }),
    /at most 20 text layers/
  )
})

test('applying a brand kit keeps properties a person changed since', () => {
  const read = (version: number) =>
    readBrandKit({
      id: 'kit1',
      name: 'Acme',
      status: 'ACTIVE',
      version,
      definition: { colors: { background: '#101010', text: '#fafafa', accent: '#00aaff' } },
    })
  const kit = read(2)
  assert.ok(kit)
  let canvas: CanvasDocument = canvasDocumentSchema.parse({
    version: 1,
    kind: 'canvas',
    artboards: [blankArtboard('wide-16x9', { x: 0, y: 0, newId: ids() })],
  })
  const id = canvas.artboards[0]!.id
  const first = brandCommand(canvas, [id], kit, ['colors', 'background'])
  canvas = applyCanvasCommand(canvas, first.command!)
  const applied = canvas.artboards[0]!.document
  assert.equal(applied.brand?.kitId, 'kit1')
  const changed = structuredClone(canvas)
  changed.artboards[0]!.document.background = {
    ...applied.background!,
    type: 'solid',
    value: '#123456',
  }
  const again = brandCommand(changed, [id], read(3)!, ['colors', 'background'])
  const reapplied = applyCanvasCommand(changed, again.command!).artboards[0]!.document
  assert.equal(reapplied.background?.value, '#123456', 'the manual override survives')
  assert.ok(again.keptOverrides >= 1)
  const reset = brandCommand(changed, [id], kit, ['colors', 'background'], { resetOverrides: true })
  assert.notEqual(
    applyCanvasCommand(changed, reset.command!).artboards[0]!.document.background?.value,
    '#123456'
  )
  assert.equal(brandCommand(canvas, [], kit, ['colors']).command, null)
})

test('exports name files predictably, follow reading order and hide hidden layers unless asked', () => {
  const newId = ids()
  const canvas = canvasDocumentSchema.parse({
    version: 1,
    kind: 'canvas',
    artboards: [
      blankArtboard('square-1x1', { x: 2000, y: 0, newId, name: 'Square / ünïcode!' }),
      blankArtboard('wide-16x9', { x: 0, y: 0, newId, name: 'Hero' }),
    ],
  })
  const order = exportSelection(
    canvas,
    canvas.artboards.map((artboard) => artboard.id)
  )
  assert.deepEqual(
    order.map((artboard) => artboard.name),
    ['Hero', 'Square / ünïcode!']
  )
  assert.deepEqual(
    exportSelection(
      canvas,
      canvas.artboards.map((artboard) => artboard.id),
      'layers'
    ).map((artboard) => artboard.name),
    ['Square / ünïcode!', 'Hero']
  )
  assert.equal(
    artboardFileName('Launch Q4', order[1]!, 1, 7, 'webp', 2),
    'launch-q4-02-square-unicode-2160x2160-r7.webp'
  )
  const hidden = structuredClone(order[0]!.document)
  hidden.texts[0]!.visible = false
  assert.equal(documentForExport(hidden, {}).texts[0]!.visible, false)
  assert.equal(documentForExport(hidden, { includeHidden: true }).texts[0]!.visible, true)
  assert.equal(hidden.texts[0]!.visible, false, 'the saved document is untouched')
})

test('imports copy native documents losslessly and pin exactly what was copied', async () => {
  const now = new Date('2026-10-20T10:00:00Z')
  const source = designDocumentSchema.parse({
    version: 2,
    image: { src: 'asset:11111111-1111-4111-8111-111111111111' },
    texts: [{ text: 'Hello', fontSize: 0.05, position: { x: 50, y: 50 } }],
  })
  const project = await artboardFromProject(
    { id: 'proj', name: 'Launch', revision: 4, document: source },
    { x: 10, y: 20, newId: ids(), now }
  )
  assert.equal(project.origin?.kind, 'project')
  assert.equal(project.origin?.kind === 'project' && project.origin.revision, 4)
  assert.match(
    project.origin?.kind === 'project' ? project.origin.documentHash : '',
    /^[a-f0-9]{64}$/
  )
  assert.equal(project.document.texts[0]!.text, 'Hello')
  assert.ok(project.document.texts[0]!.id, 'anonymous layers receive stable ids for merging')
  const design = await artboardFromDesign(
    { id: 'des', name: 'Generated', campaignId: 'camp', document: source },
    { x: 0, y: 0, newId: ids(), now }
  )
  assert.deepEqual(design.context, { campaignId: 'camp' })
  const set = createCreativeSet(
    {
      headline: 'Approvals',
      supporting: '',
      source: {
        id: 's',
        revision: 1,
        src: 'asset:11111111-1111-4111-8111-111111111111',
        name: 'a.png',
        width: 1440,
        height: 900,
      },
      focus: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      treatment: 'product-hero',
    },
    ids()
  )
  const boards = await artboardsFromStorySet(
    { id: 'set', name: 'Set', revision: 3, document: set },
    { x: 0, y: 0, newId: ids(), now }
  )
  assert.equal(boards.length, set.outputs.length)
  assert.ok(
    boards.every((board) => board.origin?.kind === 'story-set' && board.origin.revision === 3)
  )
  const rects = boards.map(artboardRect)
  assert.ok(
    rects.every(
      (rect, index) => index === 0 || rect.x > rects[index - 1]!.x + rects[index - 1]!.width - 1
    ),
    'laid out left to right'
  )
  assert.equal(
    boards[0]!.document.texts.find((text) => text.role === 'headline')?.text,
    'Approvals',
    'linked copy resolved'
  )
})

test('alternative layouts add artboards beside the original and keep claim status', () => {
  const [source] = buildRecipe(
    'feature-announcement',
    { release, featureIndex: 0, screenshots: [shot] },
    { newId: ids(), fill }
  )
  const before = structuredClone(source!)
  const alternatives = alternativeLayouts(source!, shot, { newId: ids() })
  assert.equal(alternatives.length, 4)
  assert.deepEqual(source, before, 'the original is untouched')
  for (const artboard of alternatives) {
    assert.equal(artboard.document.image.src, shot.src)
    assert.equal(artboard.document.texts[0]!.text, 'Bulk approve')
    const claim = artboard.provenance.find(
      (entry) => entry.layerId === artboard.document.texts[0]!.id
    )
    assert.equal(claim?.status, 'verified', 'the quoted feature stays verified')
  }
  const xs = alternatives.map((artboard) => artboard.x)
  assert.deepEqual(
    [...xs].sort((a, b) => a - b),
    xs,
    'laid out left to right'
  )
  assert.equal(new Set(xs).size, 4)
})
