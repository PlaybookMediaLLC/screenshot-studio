import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { TRPCClient } from '@trpc/client'
import cors from '../../../../infra/storage/tenant-cors.json'
import type { AppRouter } from '@/lib/trpc/router'
import { buildExportFileName, saveExportToWorkspace } from '@/lib/workspace/save-export'

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
  assert.match(name, /^shots-[\w-]+\.png$/)
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

test('production storage permits signed browser uploads from the current application origin', () => {
  const rule = cors.rules.find((rule) =>
    rule.allowed.origins.includes('https://shots.playbookmedia.io')
  )
  assert.ok(rule, 'the current site must pass the storage preflight')
  assert.ok(rule.allowed.methods.includes('PUT'))
  assert.ok(rule.allowed.methods.includes('GET'))
  assert.ok(rule.allowed.headers.includes('content-type'))
  assert.ok(rule.allowed.headers.includes('if-none-match'), 'write-once upload header is allowed')
  assert.ok(cors.rules.every((rule) => !rule.allowed.origins.includes('*')))
})

const PART = 16 * 1024 * 1024
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A tRPC client and storage that record what the uploader asked for. */
function fakeUpload(stored: number[] = [], failOnce?: string) {
  const calls: { name: string; input: unknown }[] = []
  const puts: { url: string; bytes: number; headers: Record<string, string> }[] = []
  const mutation = (name: string, answer: (input: never) => unknown) => ({
    mutate: async (input: never) => {
      calls.push({ name, input })
      return answer(input)
    },
  })
  const client = {
    billing: { summary: { query: async () => ({ plan: 'pro' }) } },
    asset: {
      signUpload: mutation('signUpload', () => ({
        asset: { id: 'small' },
        uploadUrl: 'https://storage.test/small',
      })),
      signUploadInParts: mutation('signUploadInParts', () => ({
        asset: { id: 'large' },
        uploadUrl: '',
        multipart: { partBytes: PART, parts: 2 },
      })),
      uploadParts: mutation('uploadParts', (input: { parts: number[] }) => ({
        partBytes: PART,
        parts: 2,
        uploaded: stored,
        urls: input.parts.map((number) => ({ number, url: `https://storage.test/part-${number}` })),
      })),
      completeUpload: mutation('completeUpload', () => ({ asset: {} })),
    },
  } as unknown as TRPCClient<AppRouter>
  const fetch = async (url: string, init: { body: Blob; headers: Record<string, string> }) => {
    puts.push({ url, bytes: init.body.size, headers: init.headers })
    if (url === failOnce) {
      failOnce = undefined
      return new Response(null, { status: 500 })
    }
    return new Response(null, { status: 200 })
  }
  return { calls, client, fetch, puts }
}

test("a large file goes in parts, retries a failed part, and sends each part's digest", async (t) => {
  const bytes = new Uint8Array(PART + 10).map((_, i) => i % 251)
  const upload = fakeUpload([], 'https://storage.test/part-2')
  t.mock.method(globalThis, 'fetch', upload.fetch)
  const saved = await saveExportToWorkspace({
    blob: new Blob([bytes], { type: 'video/mp4' }),
    fileName: 'clip.mp4',
    trpcClient: upload.client,
  })
  assert.equal(saved.assetId, 'large')
  assert.deepEqual(
    upload.puts.map((put) => [put.url, put.bytes]),
    [
      ['https://storage.test/part-1', PART],
      ['https://storage.test/part-2', 10],
      ['https://storage.test/part-2', 10],
    ]
  )
  // Parts are not write-once: storage replaces a part sent again.
  assert.ok(upload.puts.every((put) => !('if-none-match' in put.headers)))
  assert.equal(upload.calls[0].name, 'signUploadInParts')
  assert.equal((upload.calls[0].input as { sha256?: string }).sha256, undefined)
  assert.deepEqual(upload.calls.at(-1), {
    name: 'completeUpload',
    input: {
      assetId: 'large',
      partSha256: [sha(bytes.subarray(0, PART)), sha(bytes.subarray(PART))],
    },
  })
})

test('a resumed upload sends only the parts storage does not hold', async (t) => {
  const bytes = new Uint8Array(PART + 10).fill(7)
  const upload = fakeUpload([1])
  t.mock.method(globalThis, 'fetch', upload.fetch)
  await saveExportToWorkspace({
    blob: new Blob([bytes], { type: 'video/mp4' }),
    fileName: 'clip.mp4',
    trpcClient: upload.client,
    resumeAssetId: 'large',
  })
  assert.deepEqual(
    upload.puts.map((put) => put.url),
    ['https://storage.test/part-2']
  )
  assert.ok(!upload.calls.some((call) => call.name.startsWith('sign')))
  assert.equal(
    (upload.calls.at(-1)?.input as { partSha256: string[] }).partSha256[0],
    sha(bytes.subarray(0, PART))
  )
})

test('without Web Crypto a large file is refused before anything is reserved or sent', async (t) => {
  const upload = fakeUpload()
  t.mock.method(globalThis, 'fetch', upload.fetch)
  t.mock.getter(globalThis, 'crypto', () => ({}))
  await assert.rejects(
    saveExportToWorkspace({
      blob: new Blob([new Uint8Array(PART + 1)], { type: 'video/mp4' }),
      fileName: 'clip.mp4',
      trpcClient: upload.client,
    }),
    /secure \(HTTPS\) connection/
  )
  assert.deepEqual([upload.calls, upload.puts], [[], []])
})

test('a small file keeps the single write-once PUT and its whole digest', async (t) => {
  const bytes = new TextEncoder().encode('small file')
  const upload = fakeUpload()
  t.mock.method(globalThis, 'fetch', upload.fetch)
  await saveExportToWorkspace({
    blob: new Blob([bytes], { type: 'image/png' }),
    fileName: 'a.png',
    trpcClient: upload.client,
  })
  assert.deepEqual(upload.puts, [
    {
      url: 'https://storage.test/small',
      bytes: bytes.length,
      headers: { 'content-type': 'image/png', 'if-none-match': '*' },
    },
  ])
  assert.deepEqual(upload.calls.at(-1)?.input, { assetId: 'small', sha256: sha(bytes) })
})
