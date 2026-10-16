import assert from 'node:assert/strict'
import test from 'node:test'
import { needsSignIn, productPageRedirect, SIGNED_IN_PATHS } from '../lib/auth/sign-in-gate'
import { TOOL_SLUGS } from '../lib/seo/tools'

function request(path: string, cookie?: string) {
  const headers = new Headers(cookie ? { cookie } : {})
  return { headers, nextUrl: new URL(`https://shots.playbookmedia.io${path}`) }
}

test('every image tool and conversion page needs sign-in', () => {
  for (const slug of TOOL_SLUGS) {
    assert.ok(needsSignIn(slug), `${slug} is not gated`)
  }
  assert.ok(SIGNED_IN_PATHS.length > 0)
})

test('product pages need sign-in in every locale; marketing pages do not', () => {
  assert.ok(needsSignIn('/code'))
  assert.ok(needsSignIn('/de/tweet'))
  assert.ok(needsSignIn('/store-screenshots/new'))
  for (const path of [
    '/landing',
    '/pricing',
    '/tools',
    '/features/code-snippets',
    '/docs',
    '/de',
    '/codex',
  ]) {
    assert.equal(needsSignIn(path), false, path)
  }
})

const paid = { hasOrganization: true, isWorkspaceOperational: true, hasPaidPlan: true }
const session = 'better-auth.session_token=abc'

test('a visitor without a session goes to sign-in and comes back', async () => {
  const target = await productPageRedirect(request('/fr/compress-image?q=1'), async () => paid)
  assert.equal(target?.pathname, '/fr/sign-in')
  assert.equal(target?.searchParams.get('callbackURL'), '/fr/compress-image?q=1')
  assert.equal(await productPageRedirect(request('/pricing'), async () => null), null)
})

test('a stale session cookie is checked, not trusted', async () => {
  const target = await productPageRedirect(request('/code', session), async () => null)
  assert.equal(target?.pathname, '/sign-in')
})

test('there is no free plan: an unpaid workspace is sent to choose a plan', async () => {
  const unpaid = { ...paid, hasPaidPlan: false }
  const target = await productPageRedirect(request('/de/tweet', session), async () => unpaid)
  assert.equal(target?.href, 'https://shots.playbookmedia.io/de/pricing?subscribe=required')
  const noWorkspace = { ...paid, hasOrganization: false }
  const onboarding = await productPageRedirect(request('/code', session), async () => noWorkspace)
  assert.equal(onboarding?.pathname, '/onboarding')
})

test('a paid workspace on any session cookie name gets through', async () => {
  assert.equal(await productPageRedirect(request('/code', session), async () => paid), null)
  const secure = request('/code', '__Secure-better-auth.session_token=abc')
  assert.equal(await productPageRedirect(secure, async () => paid), null)
})
