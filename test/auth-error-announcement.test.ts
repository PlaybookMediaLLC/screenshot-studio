import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Auth failures are the one message a user must not miss: a rejected password
 * or an expired invitation leaves the page otherwise unchanged, so a sighted
 * user notices the red block but a screen-reader user gets silence unless the
 * container is a live region.
 *
 * These error blocks are also the only evidence an end-to-end test has for why
 * a sign-in stalled. Without an announced role the failure surfaces as a bare
 * URL-poll timeout, which is exactly how the two-factor spec's flake hid its
 * own cause. Keeping the role attached preserves both the accessibility
 * guarantee and the diagnostic.
 */
const AUTH_COMPONENTS = join(process.cwd(), 'components/auth')
const ERROR_BLOCK = /text-destructive"[^>]*>\s*\{error\}/g

function authSources(): { name: string; source: string }[] {
  return readdirSync(AUTH_COMPONENTS)
    .filter((file) => file.endsWith('.tsx'))
    .map((name) => ({ name, source: readFileSync(join(AUTH_COMPONENTS, name), 'utf8') }))
}

/** Reports error blocks whose opening tag lacks role="alert". */
function unannouncedErrorBlocks(source: string): string[] {
  return (source.match(ERROR_BLOCK) ?? []).filter((block) => !block.includes('role="alert"'))
}

test('every auth error block renders as a live region', () => {
  const offenders = authSources().flatMap(({ name, source }) =>
    unannouncedErrorBlocks(source).map((block) => `${name}: ${block.trim()}`)
  )
  assert.deepEqual(offenders, [])
})

test('the scan covers real error blocks rather than passing vacuously', () => {
  const announced = authSources().reduce(
    (total, { source }) => total + (source.match(ERROR_BLOCK) ?? []).length,
    0
  )
  assert.ok(announced >= 5, `expected at least 5 auth error blocks, found ${announced}`)
})

test('the scan detects an error block that would not be announced', () => {
  const regressed = '<p className="rounded-md p-3 text-sm text-destructive">{error}</p>'
  assert.equal(unannouncedErrorBlocks(regressed).length, 1)
  const fixed = '<p className="text-destructive" role="alert">{error}</p>'
  assert.equal(unannouncedErrorBlocks(fixed).length, 0)
})
