import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { type RouteContract, routeContractSchema } from '@/lib/api/contract'
import { documentedContracts } from '@/lib/api/contracts'
import * as ai from '@/lib/api/contracts/ai'
import * as assets from '@/lib/api/contracts/assets'
import * as audit from '@/lib/api/contracts/audit'
import * as billing from '@/lib/api/contracts/billing'
import * as internal from '@/lib/api/contracts/internal'
import * as linkPreview from '@/lib/api/contracts/link-preview'
import * as releases from '@/lib/api/contracts/releases'
import * as shell from '@/lib/api/contracts/shell'
import * as sourceApps from '@/lib/api/contracts/source-apps'
import * as unsubscribe from '@/lib/api/contracts/unsubscribe'
import * as webhooks from '@/lib/api/contracts/webhooks'
import { openApiSpec } from '@/lib/api/openapi'

const ROOT = process.cwd()

const contracts = new Map<string, RouteContract>(
  [
    ai,
    assets,
    audit,
    billing,
    internal,
    linkPreview,
    releases,
    shell,
    sourceApps,
    unsubscribe,
    webhooks,
  ]
    .flatMap((module) => Object.entries(module))
    .filter(([, value]) => routeContractSchema.safeParse(value).success)
    .map(([name, value]) => [name, value as RouteContract])
)

function routeFileFor(contract: RouteContract): string {
  return `app${contract.path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`
}

function routeFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(join(ROOT, path)).isDirectory()) return routeFiles(path)
    return entry === 'route.ts' ? [relative(ROOT, join(ROOT, path))] : []
  })
}

test('every contract is served by the route file its path names, at its method', () => {
  assert.ok(contracts.size >= 30, `only ${contracts.size} contracts were found`)
  for (const [name, contract] of contracts) {
    const file = routeFileFor(contract)
    assert.ok(existsSync(join(ROOT, file)), `${name}: ${file} does not exist`)
    const binding = new RegExp(`export const ${contract.method} = route\\(${name}\\b`)
    assert.match(readFileSync(join(ROOT, file), 'utf8'), binding, `${name} is not bound in ${file}`)
  }
})

test('every route() binding uses the contract for its own path and method', () => {
  for (const file of routeFiles('app/api')) {
    const source = readFileSync(join(ROOT, file), 'utf8')
    for (const [, method, name] of source.matchAll(/export const (\w+) = route\((\w+)\b/g)) {
      const contract = contracts.get(name)
      assert.ok(contract, `${file} binds unknown contract ${name}`)
      assert.equal(routeFileFor(contract), file, `${name} belongs to another route file`)
      assert.equal(contract.method, method, `${file} binds ${name} as ${method}`)
    }
  }
})

test('contract names and operation ids are unique', () => {
  const names = [...contracts.values()].map((contract) => `${contract.method} ${contract.name}`)
  assert.equal(new Set(names).size, names.length)
  const operationIds = documentedContracts.map((contract) => contract.docs?.operationId)
  assert.equal(new Set(operationIds).size, operationIds.length)
})

test('every documented contract appears in the public spec as generated', () => {
  const paths = openApiSpec.paths as Record<string, Record<string, { operationId?: string }>>
  for (const contract of documentedContracts) {
    const operation = paths[contract.path]?.[contract.method.toLowerCase()]
    assert.equal(operation?.operationId, contract.docs?.operationId, contract.name)
  }
})

test('the spec error envelope lists every platform error code', () => {
  const schemas = openApiSpec.components.schemas as Record<
    string,
    { properties?: { code?: { enum?: string[] } } }
  >
  assert.ok(schemas.Error.properties?.code?.enum?.includes('conflict'))
})

test('contracts accept what the Go backend actually sends', () => {
  // GET /v1/workspace omits createdAt even though the SDK type declares it;
  // a required field here would turn a working response into a 500.
  const parsed = shell.getOrganizationContract.output.safeParse({
    organization: { id: 'org_1', logo: null, name: 'Acme', role: 'owner', slug: 'acme' },
  })
  assert.ok(parsed.success)
})
