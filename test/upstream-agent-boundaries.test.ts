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
  assert.match(proxySource, /url\.searchParams\.set\('path', request\.nextUrl\.pathname\)/)
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
})

test('privacy copy describes implemented account, analytics, and rate-limit behavior', () => {
  const privacySource = source('app/[locale]/privacy-policy/page.tsx')
  assert.match(privacySource, /account and workspace membership are\s+required/i)
  assert.match(privacySource, /one-way hash derived from your client\s+address in Redis/i)
  assert.match(privacySource, /when the deployment configures a\s+PostHog key/i)
  assert.doesNotMatch(privacySource, /Databuddy|There is no\s+account/i)
})
