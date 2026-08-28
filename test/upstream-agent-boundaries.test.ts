import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertMarkdownRouteDoesNotTrustHeaders(routeSource: string): void {
  assert.doesNotMatch(routeSource, /request\.headers|get\(["']x-markdown-path["']\)/i)
  assert.match(routeSource, /searchParams\.get\(["']path["']\)/)
}

function assertStandaloneRewriteGuard(proxySource: string): void {
  assert.match(proxySource, /x-next-intl-locale/)
  assert.match(proxySource, /isStandaloneLocaleRewrite\(request\)/)
  assert.match(proxySource, /github\.com\/vercel\/next\.js\/issues\/95528/)
}

function assertAgentRouteUsesCanonicalContent(routeSource: string): void {
  assert.match(routeSource, /from ['"]@\/lib\/agents\/llms['"]/)
  assert.doesNotMatch(routeSource, /opennookorg|\.replace\(/i)
}

test('markdown route uses the rewritten URL cache key and ignores spoofed routing headers', () => {
  const routeSource = source('app/api/md/route.ts')
  assertMarkdownRouteDoesNotTrustHeaders(routeSource)

  const negativeControl = `request.headers.get("x-markdown-path")\n${routeSource}`
  assert.throws(() => assertMarkdownRouteDoesNotTrustHeaders(negativeControl))
})

test('Next 16 proxy owns content negotiation and preserves cache separation', () => {
  const proxySource = source('proxy.ts')
  assert.match(proxySource, /export function proxy\(/)
  assert.match(proxySource, /prefersMarkdown\(accept\)/)
  assert.match(proxySource, /url\.pathname = `\/api\/md\$\{request\.nextUrl\.pathname/)
  assert.doesNotMatch(proxySource, /searchParams\.set\(['"]path['"]/)
  assert.match(source('app/api/md/[...path]/route.ts'), /path\.join\(['"]\/['"]\)/)
  assertStandaloneRewriteGuard(proxySource)
  const missingStandaloneGuard = proxySource.replaceAll('x-next-intl-locale', 'x-missing-locale')
  assert.throws(() => assertStandaloneRewriteGuard(missingStandaloneGuard))
  assert.match(proxySource, /Vary['"], ['"]Accept, Accept-Encoding/)
  assert.match(proxySource, /isFrameworkRequest\(request\)/)
})

test('upstream merge preserves the canonical fork workflow and public identity', () => {
  assert.throws(() => source('.github/workflows/upstream-sync.yml'))
  assert.match(
    source('.github/workflows/sync-upstream.yml'),
    /KartikLabhshetwar\/screenshot-studio/
  )

  for (const path of [
    'CONTRIBUTING.md',
    'components/landing/Footer.tsx',
    'components/ui/github-star-button.tsx',
    'lib/agents/llms.ts',
    'lib/seo/json-ld.ts',
  ]) {
    const contents = source(path)
    assert.doesNotMatch(contents, /opennookorg\/screenshot-studio/i, path)
    assert.match(contents, /PlaybookMediaLLC\/screenshot-studio/, path)
  }

  for (const path of ['app/api/llms/route.ts', 'app/api/llms-full/route.ts']) {
    const contents = source(path)
    assertAgentRouteUsesCanonicalContent(contents)

    const negativeControl = contents.replace(
      /from ['"]@\/lib\/agents\/llms['"]/,
      "from '@opennookorg/screenshot-studio'"
    )
    assert.throws(() => assertAgentRouteUsesCanonicalContent(negativeControl), path)
  }
})

test('privacy copy describes implemented account, analytics, and rate-limit behavior', () => {
  const privacySource = source('app/[locale]/privacy-policy/page.tsx')
  assert.match(privacySource, /account and workspace membership are\s+required/i)
  assert.match(privacySource, /one-way hash derived from your client\s+address in Redis/i)
  assert.match(privacySource, /when the deployment configures a\s+PostHog key/i)
  assert.doesNotMatch(privacySource, /Databuddy|There is no\s+account/i)
})
