import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

/**
 * The platform API's rules, enforced on source so they survive refactors:
 *
 * 1. Every fork route goes through `route()` with a contract, re-exports a
 *    route that does, or is on the exemption list with a reason.
 * 2. API code declares no naked types: every type alias is `z.infer`,
 *    `z.input`, or `z.output`; no `interface`, no string-literal unions, no
 *    `typeof array[number]` unions.
 * 3. Every export in API code has TSDoc.
 *
 * Upstream editor files keep their upstream code to keep merges cheap.
 */

const ROOT = process.cwd()

const UPSTREAM_FILES = new Set([
  'app/api/[...unmatched]/route.ts',
  'app/api/cleanup-cache/route.ts',
  'app/api/export/route.ts',
  'app/api/image-proxy/route.ts',
  'app/api/llms-full/route.ts',
  'app/api/llms/route.ts',
  'app/api/md/route.ts',
  'app/api/openapi/route.ts',
  'app/api/screenshot/invalidate/route.ts',
  'app/api/screenshot/route.ts',
  'app/api/tweet/[id]/route.ts',
  'lib/api/errors.ts',
  'lib/api/openapi.ts',
])

const ROUTE_EXEMPTIONS: Record<string, string> = {
  'app/api/auth/[...all]/route.ts':
    'Better Auth owns this pipeline; it shares the zod parsing and rate-limit helpers instead.',
  'app/api/health/route.ts': 'Polled constantly; a log line per probe would be noise.',
  'app/api/md/[...path]/route.ts': 'A cacheable content route, not an API operation.',
  'app/api/trpc/[trpc]/route.ts': 'tRPC has its own middleware and shares toApiFailure.',
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [relative(ROOT, join(ROOT, path))] : []
  })
}

const apiFiles = [...sourceFiles('app/api'), ...sourceFiles('lib/api')].filter(
  (file) => !UPSTREAM_FILES.has(file)
)

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

/** Problems with how a route file serves requests, or null when it is fine. */
function routeProblem(file: string, source: string): string | null {
  if (ROUTE_EXEMPTIONS[file]) return null
  if (/^export \{[^}]+\} from '@\/app\/api\/v1\/[^']+'$/m.test(source.trim())) return null
  const handlers = source.match(
    /^export (const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b.*$/gm
  )
  if (!handlers?.length) return 'exports no route handler'
  const unwrapped = handlers.filter((line) => !/= route\(\s*\w+Contract\b/.test(line))
  return unwrapped.length ? `does not use route(contract): ${unwrapped.join('; ')}` : null
}

/** Naked type declarations in `source`. */
function nakedTypes(source: string): string[] {
  const problems: string[] = []
  for (const match of source.matchAll(/^(?:export )?type (\w+)(?:<[^=]*>)?\s*=\s*(\S+)/gm)) {
    if (!/^z\.(infer|input|output)</.test(match[2])) problems.push(`type ${match[1]}`)
  }
  for (const match of source.matchAll(/^(?:export )?interface (\w+)/gm)) {
    problems.push(`interface ${match[1]}`)
  }
  for (const match of source.matchAll(/[:<,=]\s*'[^'\n]*'\s*\|\s*'[^'\n]*'/g)) {
    problems.push(`string-literal union ${match[0].trim()}`)
  }
  for (const match of source.matchAll(/typeof \w+\)\[number\]/g)) {
    problems.push(`const-array union ${match[0]}`)
  }
  return problems
}

/** Exports in `source` without a TSDoc block directly above them. */
function undocumentedExports(source: string): string[] {
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!/^export (default )?(async )?(const|let|function|class|type)\b/.test(line)) return []
    const previous = lines[index - 1]?.trim() ?? ''
    return previous.endsWith('*/') ? [] : [line.slice(0, 80)]
  })
}

test('every fork route goes through route() with a contract or is exempt with a reason', () => {
  const routes = apiFiles.filter(
    (file) => file.startsWith('app/api/') && file.endsWith('/route.ts')
  )
  assert.ok(routes.length > 20, 'the route scan found too few files to be meaningful')

  const problems = routes.flatMap((file) => {
    const problem = routeProblem(file, read(file))
    return problem ? [`${file}: ${problem}`] : []
  })
  assert.deepEqual(problems, [])

  for (const [file, reason] of Object.entries(ROUTE_EXEMPTIONS)) {
    assert.ok(routes.includes(file), `exempt route ${file} no longer exists; drop the exemption`)
    assert.ok(reason.length > 20, `exemption for ${file} needs a real reason`)
  }
})

test('API code declares only zod-derived types', () => {
  const problems = apiFiles.flatMap((file) =>
    nakedTypes(read(file)).map((problem) => `${file}: ${problem}`)
  )
  assert.deepEqual(problems, [])
})

test('every export in API code has TSDoc', () => {
  const problems = apiFiles.flatMap((file) =>
    undocumentedExports(read(file)).map((line) => `${file}: ${line}`)
  )
  assert.deepEqual(problems, [])
})

test('the scans catch what they claim to catch', () => {
  // Negative controls: each detector flags a real violation, so the
  // assertions above cannot pass because a detector matches nothing.
  assert.deepEqual(nakedTypes("type Mode = 'a' | 'b'"), [
    'type Mode',
    "string-literal union = 'a' | 'b'",
  ])
  assert.deepEqual(nakedTypes('export interface Thing { id: string }'), ['interface Thing'])
  assert.deepEqual(nakedTypes('type Scope = (typeof scopes)[number]'), [
    'type Scope',
    'const-array union typeof scopes)[number]',
  ])
  assert.deepEqual(nakedTypes('export type Ok = z.infer<typeof okSchema>'), [])
  assert.deepEqual(undocumentedExports('const a = 1\nexport const b = 2'), ['export const b = 2'])
  assert.deepEqual(undocumentedExports('/** B. */\nexport const b = 2'), [])
  assert.equal(
    routeProblem('app/api/x/route.ts', 'export async function GET() {}'),
    'does not use route(contract): export async function GET() {}'
  )
  assert.equal(
    routeProblem('app/api/x/route.ts', 'export const GET = route(listContract, {})'),
    null
  )
})
