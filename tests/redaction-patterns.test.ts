import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyToken,
  detectSensitiveText,
  entropy,
  luhn,
  nameConfidence,
  type OcrWord,
} from '../lib/redaction/patterns'

const image = { height: 1000, width: 2000 }

/** OCR words laid out left to right on numbered lines. */
function line(texts: string[], lineIndex: number, confidence = 95): OcrWord[] {
  let x = 10
  return texts.map((text) => {
    const width = text.length * 10
    const word = { bbox: { x0: x, x1: x + width, y0: lineIndex * 40, y1: lineIndex * 40 + 20 }, confidence, line: lineIndex, text }
    x += width + 10
    return word
  })
}

test('emails and known key formats are found with high confidence', () => {
  assert.equal(classifyToken('jane.doe@example.com')?.kind, 'email')
  assert.equal(classifyToken('(ops@acme.io)')?.kind, 'email', 'punctuation around a token is ignored')
  for (const key of [
    'AKIAIOSFODNN7EXAMPLE',
    'ghp_1234567890abcdefghijABCDEFGHIJ123456',
    'xoxb-1234567890-abcdefghij',
    'sk_live_51HabcdefghijklmnopQR',
    'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
    'AIzaSyA1234567890abcdefghijklmnopqrstuv',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij12345',
  ]) {
    assert.equal(classifyToken(key)?.kind, 'credential', key)
  }
  assert.equal(classifyToken('password=hunter22')?.kind, 'credential')
})

test('ordinary interface text is not flagged', () => {
  for (const word of ['Dashboard', 'Settings', 'Welcome', 'v2.4.1', '2026', 'https://example.com/docs', 'Projects']) {
    assert.equal(classifyToken(word), null, word)
  }
  assert.equal(nameConfidence('Sign', 'Out'), 0)
  assert.equal(nameConfidence('Open', 'Settings'), 0)
})

test('cards pass the Luhn check and random tokens have high entropy', () => {
  assert.equal(luhn('4242424242424242'), true)
  assert.equal(luhn('4242424242424241'), false)
  assert.ok(entropy('aB3xQ9pL2mZ7vK4nR8tY1wC6') > 4)
  assert.ok(entropy('aaaaaaaaaaaaaaaaaaaaaaaa') < 1)
})

test('a page of OCR words yields boxed, confidence-ranked findings', () => {
  const words = [
    ...line(['Contact', 'jane.doe@example.com', 'today'], 0),
    ...line(['API', 'key', 'AKIAIOSFODNN7EXAMPLE'], 1),
    ...line(['password:', 'hunter22'], 2),
    ...line(['Card', '4242', '4242', '4242', '4242'], 3),
    ...line(['Signed', 'by', 'Sarah', 'Connor'], 4),
    ...line(['Open', 'Settings'], 5),
  ]
  const findings = detectSensitiveText(words, image)
  const kinds = findings.map((finding) => finding.kind).sort()
  assert.deepEqual(kinds, ['card', 'credential', 'credential', 'email', 'name'])
  const email = findings.find((finding) => finding.kind === 'email')!
  assert.ok(email.box.x > 0 && email.box.x + email.box.width <= 1)
  assert.ok(email.confidence > 0.8)
  const name = findings.find((finding) => finding.kind === 'name')!
  assert.ok(name.confidence < email.confidence, 'names are less certain than emails')
  const card = findings.find((finding) => finding.kind === 'card')!
  assert.ok(card.box.width > 0.05, 'the whole card number is covered')
})

test('low OCR confidence lowers a finding', () => {
  const sure = detectSensitiveText(line(['ops@acme.io'], 0, 95), image)[0]!
  const unsure = detectSensitiveText(line(['ops@acme.io'], 0, 30), image)[0]!
  assert.ok(unsure.confidence < sure.confidence)
})

test('redactions are strong enough to be unreadable and stay inside the image', async () => {
  const { redactionStrength, regionPixels } = await import('../lib/redaction/apply')
  assert.equal(redactionStrength('pixelate', 300, 30), 10, 'small text still gets 10px blocks')
  assert.equal(redactionStrength('pixelate', 600, 90), 30)
  assert.equal(redactionStrength('blur', 600, 90), 45)
  assert.equal(redactionStrength('cover', 600, 90), 0)
  assert.deepEqual(regionPixels({ height: 0.5, width: 0.6, x: 0.7, y: -0.1 }, 1000, 200), {
    height: 80,
    width: 300,
    x: 700,
    y: 0,
  })
})
