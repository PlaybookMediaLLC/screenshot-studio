import assert from 'node:assert/strict'
import test from 'node:test'
import {
  googleFontCss,
  googleFontId,
  googleFontsStylesheet,
  googleFontWeights,
  isGoogleFontId,
} from '../lib/typography/google-fonts'
import { fitFontSize, textFillCss } from '../lib/typography/text-style'

test('Google Fonts ids are validated and build the CSS2 URL', () => {
  assert.equal(googleFontId('  Space   Grotesk '), 'google:Space Grotesk')
  assert.equal(googleFontId('<script>'), null)
  assert.equal(isGoogleFontId('google:Space Grotesk'), true)
  assert.equal(isGoogleFontId('google:../x'), false)
  assert.equal(isGoogleFontId('inter'), false)
  assert.equal(
    googleFontsStylesheet('google:Space Grotesk', ['bold', 'normal', '500']),
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=block'
  )
  assert.match(googleFontCss('google:Fira Code'), /^"Fira Code", .*monospace/)
  assert.ok(googleFontWeights('google:Unknown Family').includes('bold'))
})

test('shrink-to-fit scales the widest line into the box and never grows text', () => {
  const measure = (line: string) => line.length * 10
  assert.equal(fitFontSize(['short'], 40, 400, measure), 40)
  assert.equal(fitFontSize(['a very long headline here', 'x'], 40, 125, measure), 20)
  assert.equal(fitFontSize(['a very long headline here'], 40, 10, measure, 12), 12)
})

test('a gradient fill clips to the glyphs; solid uses the colour', () => {
  assert.deepEqual(textFillCss(undefined, '#fff'), { color: '#fff' })
  const css = textFillCss({ angle: 90, from: '#ff0080', kind: 'gradient', to: '#7928ca' }, '#fff')
  assert.equal(css.backgroundImage, 'linear-gradient(90deg, #ff0080, #7928ca)')
  assert.equal(css.WebkitTextFillColor, 'transparent')
})

test('every typography template yields valid document texts and keeps written copy', async () => {
  const { designDocumentSchema, DESIGN_DOCUMENT_VERSION } = await import('../lib/design/document')
  const { TYPOGRAPHY_TEMPLATES, withTypographyTemplate } =
    await import('../lib/typography/templates')
  const base = designDocumentSchema.parse({
    image: { src: null },
    texts: [
      { fontSize: 0.05, position: { x: 50, y: 10 }, role: 'headline', text: 'Ship it today' },
      { fontSize: 0.02, position: { x: 50, y: 90 }, text: 'Footer note' },
    ],
    version: DESIGN_DOCUMENT_VERSION,
  })
  for (const template of TYPOGRAPHY_TEMPLATES) {
    const texts = withTypographyTemplate(base.texts, template)
    const parsed = designDocumentSchema.parse({ ...base, texts })
    assert.equal(parsed.texts.filter((text) => text.role === 'headline').length, 1, template.id)
    assert.equal(
      parsed.texts.find((text) => text.role === 'headline')?.text,
      'Ship it today',
      template.id
    )
    assert.ok(
      parsed.texts.some((text) => text.text === 'Footer note'),
      `${template.id} keeps other text`
    )
  }
})
