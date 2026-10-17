import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * `npm ci` links every workspace the root manifest declares. An image that
 * copies only the root manifest before installing fails that step, or links
 * nothing and fails later at runtime. Each workspace manifest must therefore
 * be copied into every image that installs dependencies.
 */

const ROOT = process.cwd()
const IMAGES = ['Dockerfile', 'Dockerfile.dev']

function workspaceDirectories(): string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    workspaces: string[]
  }
  return manifest.workspaces.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) return [pattern]
    const parent = pattern.slice(0, -2)
    return readdirSync(join(ROOT, parent))
      .map((entry) => `${parent}/${entry}`)
      .filter((directory) => existsSync(join(ROOT, directory, 'package.json')))
  })
}

test('the root manifest declares the packages workspace', () => {
  assert.ok(workspaceDirectories().includes('packages/screenshot-studio-backend-sdk'))
})

for (const image of IMAGES) {
  test(`${image} copies every workspace manifest before npm ci`, () => {
    const source = readFileSync(join(ROOT, image), 'utf8')
    const install = source.search(/^RUN .*npm ci/m)
    assert.ok(install > 0, `${image} never runs npm ci`)
    for (const directory of workspaceDirectories()) {
      const copy = source.indexOf(`COPY ${directory}/package.json ./${directory}/`)
      assert.ok(copy > 0, `${image} does not copy ${directory}/package.json`)
      assert.ok(copy < install, `${image} copies ${directory}/package.json after npm ci`)
    }
  })
}

test('the lockfile links every workspace', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, unknown>
  }
  for (const directory of workspaceDirectories()) {
    assert.ok(lock.packages[directory], `package-lock.json has no entry for ${directory}`)
  }
})
