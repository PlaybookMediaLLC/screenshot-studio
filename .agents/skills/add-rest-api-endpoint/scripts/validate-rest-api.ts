import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { openApiSpec } from '../../../../lib/api/openapi'

const root = join(process.cwd(), 'app/api/v1')

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? routeFiles(path) : entry === 'route.ts' ? [path] : []
  })
}

function openApiPath(file: string): string {
  const route = relative(root, file)
    .split(sep)
    .slice(0, -1)
    .map((segment) => segment.replace(/^\[(.+)\]$/, '{$1}'))
    .join('/')
  return `/api/v1/${route}`
}

const handlerPaths = new Set(routeFiles(root).map(openApiPath))
const documentedPaths = new Set(
  Object.keys(openApiSpec.paths).filter((path) => path.startsWith('/api/v1/'))
)

assert.deepEqual(
  [...handlerPaths].sort(),
  [...documentedPaths].sort(),
  'Every v1 route and OpenAPI path must have a one-to-one match.'
)

for (const path of documentedPaths) {
  const item = openApiSpec.paths[path as keyof typeof openApiSpec.paths] as Record<string, unknown>
  assert.ok(
    ['get', 'post', 'put', 'patch', 'delete'].some((method) => method in item),
    `${path} has no documented HTTP operation.`
  )
}

process.stdout.write(`Validated ${handlerPaths.size} versioned REST paths.\n`)
