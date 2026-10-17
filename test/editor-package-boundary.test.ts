import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

/**
 * The vendored editor is a library (RFC 037). It reaches nothing the app owns:
 * no app module, no environment variable, no route of ours, no upload vendor.
 * Uploads, AI and collaboration arrive through `EditorServicesProvider` and
 * the collaboration config, so this scan keeps a coupling from creeping back
 * in with a later pull from oppulence-canvas.
 */

const ROOT = join(process.cwd(), 'packages/platejs-editor')
const SOURCE = join(ROOT, 'src')
const FORBIDDEN = [
  { pattern: /from ['"]@\//, reason: 'imports from the app' },
  { pattern: /import\(['"]@\//, reason: 'imports from the app' },
  { pattern: /process\.env/, reason: 'reads process.env' },
  { pattern: /['"`]\/api\//, reason: 'hard-codes an /api route' },
  { pattern: /uploadthing/, reason: 'depends on uploadthing' },
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs)$/.test(entry) ? [path] : []
  })
}

test('the editor package imports nothing from the app and reads no environment', () => {
  const files = sourceFiles(SOURCE)
  assert.ok(files.length > 200, `expected the vendored sources, found ${files.length}`)
  const problems = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(
      ({ reason }) => `${relative(process.cwd(), file)} ${reason}`
    )
  })
  assert.deepEqual(problems, [])
})

test('the editor package declares no upload vendor dependency', () => {
  const manifest = readFileSync(join(ROOT, 'package.json'), 'utf8')
  assert.doesNotMatch(manifest, /uploadthing/)
})

test('the boundary scan catches each forbidden coupling', () => {
  const samples = [
    "import { db } from '@/lib/db'",
    'const key = process.env.SECRET',
    "fetch('/api/ai/command')",
    "import { generateReactHelpers } from '@uploadthing/react'",
  ]
  for (const sample of samples) {
    assert.ok(
      FORBIDDEN.some(({ pattern }) => pattern.test(sample)),
      `not caught: ${sample}`
    )
  }
})
