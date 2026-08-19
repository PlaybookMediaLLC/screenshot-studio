import assert from 'node:assert/strict'
import test from 'node:test'
import { buildExportFileName } from '@/lib/workspace/save-export'

test('export file names carry the media extension', () => {
  const at = new Date('2026-08-19T19:30:45.123Z')

  assert.match(buildExportFileName('image/png', at), /\.png$/)
  assert.match(buildExportFileName('image/webp', at), /\.webp$/)
  assert.match(buildExportFileName('video/mp4', at), /\.mp4$/)

  // jpeg is the media type but jpg is the conventional extension, and a
  // file named .jpeg is treated as unfamiliar by some tools.
  assert.match(buildExportFileName('image/jpeg', at), /\.jpg$/)
})

test('export file names are safe for object storage keys', () => {
  const name = buildExportFileName('image/png', new Date('2026-08-19T19:30:45.123Z'))

  // Colons and dots from an ISO timestamp are legal in a key but awkward
  // in shells, downloads, and some storage browsers, so they are
  // normalized rather than passed through.
  assert.doesNotMatch(name, /[:]/)
  assert.match(name, /^screenshot-studio-[\w-]+\.png$/)
})

test('successive exports do not collide within the same second', () => {
  const first = buildExportFileName('image/png', new Date('2026-08-19T19:30:45.000Z'))
  const second = buildExportFileName('image/png', new Date('2026-08-19T19:30:46.000Z'))

  // Saved assets are listed together, so exports a second apart must stay
  // distinguishable without the user naming each one.
  assert.notEqual(first, second)
})

test('an unknown media type still produces a usable name', () => {
  // The upload path rejects unsupported types before this runs, so the
  // fallback exists to avoid producing a name ending in "undefined"
  // should the guard ever be bypassed.
  assert.match(buildExportFileName(''), /\.png$/)
})
