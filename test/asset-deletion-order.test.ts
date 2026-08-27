import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * A plan gate that runs before ownership is resolved leaks existence.
 *
 * `requireTenantAccess` authenticates and authorizes the caller, but it knows
 * nothing about which workspace owns the resource in the path. If a route
 * declares `feature` there, a workspace on a plan without that feature is
 * rejected with 403 before anyone checks who owns the id. The caller can then
 * tell a foreign id (403) from a nonexistent one (404), which is exactly the
 * cross-tenant disclosure the tenant-assets flow asserts against.
 *
 * Resource-scoped routes must therefore resolve ownership first and apply the
 * plan gate afterwards, inside the domain function.
 */

const API_ROOT = join(process.cwd(), 'app', 'api')

function routeFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...routeFiles(path))
    } else if (entry === 'route.ts') {
      found.push(path)
    }
  }
  return found
}

test('resource-scoped routes do not gate on plan before ownership', () => {
  const files = routeFiles(API_ROOT)

  // A silent empty scan would make this test meaningless.
  assert.ok(files.length > 0, 'no route files were scanned')

  const offenders = files
    .filter((file) => /\[[^\]]+\]/.test(file))
    .filter((file) => /^\s*feature:/m.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(process.cwd().length + 1))

  assert.deepEqual(
    offenders,
    [],
    `these routes gate on plan before resolving ownership, which lets a 403 ` +
      `confirm that another workspace's resource exists: ${offenders.join(', ')}`
  )
})

test('the scan would notice a route that reintroduces the gate', () => {
  // Negative control: the detection is a real check, not a filter that
  // happens to match nothing.
  const sample = ['access: {', "  feature: 'asset:delete',", '}'].join('\n')

  assert.equal(/^\s*feature:/m.test(sample), true)
  assert.equal(/^\s*feature:/m.test("access: { permission: 'artifact:edit' }"), false)
  assert.equal(/\[[^\]]+\]/.test('app/api/v1/assets/[assetId]/route.ts'), true)
  assert.equal(/\[[^\]]+\]/.test('app/api/tenant/assets/upload-url/route.ts'), false)
})

/**
 * The route scan above is necessary but not sufficient.
 *
 * Removing `feature` from the routes only moved the decision into the domain
 * function, so the disclosure now depends on the statement order inside
 * `deleteAsset`: the ownership lookup must precede the plan gate. Reversing
 * those two lines restores the original vulnerability while leaving every
 * route file untouched, so the scan above still passes. Verified by actually
 * reversing them, which is why this second check exists.
 */
const ASSETS_SOURCE = join(process.cwd(), 'lib', 'tenant', 'assets.ts')

function deleteAssetGateOrder(source: string): { gate: number; ownership: number } {
  const body = source.slice(source.indexOf('async function deleteAsset'))
  const scope = body.slice(0, body.indexOf('\n}\n') + 1)
  return {
    gate: scope.indexOf("requireWorkspaceFeature(context.organizationId, 'asset:delete')"),
    ownership: scope.indexOf('prisma.asset.findFirst'),
  }
}

test('deleteAsset resolves ownership before applying the plan gate', () => {
  const { gate, ownership } = deleteAssetGateOrder(readFileSync(ASSETS_SOURCE, 'utf8'))

  assert.ok(ownership !== -1, 'the ownership lookup was not found in deleteAsset')
  assert.ok(gate !== -1, 'the asset:delete plan gate was not found in deleteAsset')
  assert.ok(
    ownership < gate,
    'deleteAsset applies the asset:delete plan gate before resolving ownership, so a ' +
      "free-plan workspace gets 403 for another workspace's asset id and 404 for an " +
      'unknown one, which confirms the id exists elsewhere'
  )
})

test('the order check fails when the gate is moved ahead of ownership', () => {
  // Negative control against the exact regression: the same source with the
  // two statements swapped must be rejected.
  const vulnerable = [
    'async function deleteAsset(context, assetId) {',
    "  await requireWorkspaceFeature(context.organizationId, 'asset:delete')",
    '  const owned = await prisma.asset.findFirst({ where: { id: assetId } })',
    "  if (!owned) return 'not-found'",
    '}',
    '',
  ].join('\n')

  const { gate, ownership } = deleteAssetGateOrder(vulnerable)
  assert.ok(gate !== -1 && ownership !== -1, 'the control sample must contain both statements')
  assert.ok(gate < ownership, 'the control sample must represent the vulnerable order')
})
