import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

/**
 * The web tier holds no database credentials: every product read and write,
 * including Better Auth's, goes through the backend SDK. This scan keeps a
 * database client or connection string from creeping back into code that the
 * Next.js runtime bundles.
 */

const ROOT = process.cwd()
const RUNTIME_DIRECTORIES = ['app', 'components', 'lib', 'hooks', 'packages']
const RUNTIME_FILES = ['middleware.ts', 'proxy.ts', 'instrumentation.ts', 'next.config.ts']
const FORBIDDEN = [
  { pattern: /from ['"]@prisma\/client['"]/, reason: 'imports the Prisma client' },
  { pattern: /from ['"]@\/lib\/db['"]/, reason: 'imports the removed database module' },
  {
    pattern: /from ['"](pg|postgres|kysely|drizzle-orm)(\/[^'"]*)?['"]/,
    reason: 'imports a database driver',
  },
  {
    pattern: /process\.env\.(DATABASE_URL|DIRECT_URL|DATABASE_POOL_URL)\b/,
    reason: 'reads a database URL',
  },
]

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) found.push(path)
  }
  return found
}

function runtimeFiles(): string[] {
  return [
    ...RUNTIME_DIRECTORIES.flatMap((directory) => {
      try {
        return sourceFiles(join(ROOT, directory))
      } catch {
        return []
      }
    }),
    ...RUNTIME_FILES.map((file) => join(ROOT, file)).filter((file) => {
      try {
        return statSync(file).isFile()
      } catch {
        return false
      }
    }),
  ]
}

function violations(source: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ reason }) => reason)
}

test('web runtime code never reaches the database directly', () => {
  const files = runtimeFiles()
  assert.ok(files.length > 100, 'the runtime scan found too few files to be meaningful')
  const offenders = files.flatMap((file) =>
    violations(readFileSync(file, 'utf8')).map((reason) => `${relative(ROOT, file)} ${reason}`)
  )
  assert.deepEqual(offenders, [])
})

test('the backend SDK is the only web transport for product and social state', () => {
  const offenders = runtimeFiles()
    .filter((file) => relative(ROOT, file) !== 'lib/backend/sdk.ts')
    .filter((file) =>
      /process\.env\.(PUBLISHING_API_URL|SOCIAL_API_URL)\b|\/integrations\/social-connect\//.test(
        readFileSync(file, 'utf8')
      )
    )
    .map((file) => relative(ROOT, file))
  assert.deepEqual(offenders, [])
})

test('the web package ships no database client', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const shipped = Object.keys(manifest.dependencies ?? {}).filter((name) =>
    ['@prisma/client', 'prisma', 'pg', 'postgres', 'kysely', 'drizzle-orm'].includes(name)
  )
  assert.deepEqual(shipped, [])
})

test('the scan recognizes each forbidden access', () => {
  assert.deepEqual(violations("import { PrismaClient } from '@prisma/client'"), [
    'imports the Prisma client',
  ])
  assert.deepEqual(violations("import { prisma } from '@/lib/db'"), [
    'imports the removed database module',
  ])
  assert.deepEqual(violations("import { Pool } from 'pg'"), ['imports a database driver'])
  assert.deepEqual(violations('const url = process.env.DATABASE_URL'), ['reads a database URL'])
  assert.deepEqual(violations("import { backendSDK } from '@/lib/backend/sdk'"), [])
})
