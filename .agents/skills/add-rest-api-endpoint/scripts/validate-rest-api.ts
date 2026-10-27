import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { openApiSpec } from '../../../../clients/apps/web/lib/api/openapi'
import { documentedContracts } from '../../../../clients/apps/web/lib/api/contracts'

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

const handlers = routeFiles(root)
const handlerPaths = new Set(handlers.map(openApiPath))
const publicPaths = new Set(
  documentedContracts.map((contract) => contract.path).filter((path) => path.startsWith('/api/v1/'))
)
const documentedPaths = new Set(
  Object.keys(openApiSpec.paths).filter((path) => path.startsWith('/api/v1/'))
)

assert.deepEqual(
  [...publicPaths].sort(),
  [...documentedPaths].sort(),
  'Every public v1 contract and OpenAPI path must have a one-to-one match.'
)

// RFC 014 and contractDocsSchema explicitly exclude internal contracts from
// public OpenAPI. They still have to use the same route/contract boundary.
for (const file of handlers) {
  assert.match(
    readFileSync(file, 'utf8'),
    /\broute\s*\(/,
    `${openApiPath(file)} bypasses the route contract.`
  )
}

for (const path of documentedPaths) {
  assert.ok(handlerPaths.has(path), `${path} has no route handler.`)
  const item = openApiSpec.paths[path as keyof typeof openApiSpec.paths] as Record<string, unknown>
  assert.ok(
    ['get', 'post', 'put', 'patch', 'delete'].some((method) => method in item),
    `${path} has no documented HTTP operation.`
  )
}

process.stdout.write(
  `Validated ${handlerPaths.size} versioned REST paths and ${publicPaths.size} public OpenAPI paths.\n`
)
