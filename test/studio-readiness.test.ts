import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const studio = readFileSync('bin/studio', 'utf8')
const recoveryCheck = studio.slice(
  studio.indexOf('warm_recovery_route() {'),
  studio.indexOf('run_e2e() {')
)

for (const scenario of [
  {
    name: 'accepts an authenticated route without refreshing',
    status: '401',
    managed: true,
    ready: true,
    refresh: false,
  },
  {
    name: 'refreshes a missing managed dev route',
    status: '404',
    managed: true,
    ready: true,
    refresh: true,
  },
  {
    name: 'rejects a missing unmanaged route',
    status: '404',
    managed: false,
    ready: false,
    refresh: false,
  },
  {
    name: 'rejects a persistent server failure',
    status: '500',
    managed: true,
    ready: false,
    refresh: false,
  },
]) {
  test(`recovery readiness ${scenario.name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'studio-readiness-'))
    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          `
        set -euo pipefail
        curl() {
          [[ "$*" == *"--request POST"* ]] || exit 2
          if [[ -f refreshed ]]; then printf 401; else printf '%s' "$RESPONSE"; fi
        }
        touch() { printf '%s' "$1" > refreshed; }
        sleep() { :; }
        ${recoveryCheck}
        warm_recovery_route http://localhost/recover "$MANAGED"
      `,
        ],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            ROOT_DIR: directory,
            RESPONSE: scenario.status,
            MANAGED: String(scenario.managed),
          },
          timeout: 5000,
        }
      )
      assert.equal(result.status, scenario.ready ? 0 : 1, result.stderr)
      assert.equal(existsSync(join(directory, 'refreshed')), scenario.refresh)
      if (scenario.refresh) {
        assert.equal(
          readFileSync(join(directory, 'refreshed'), 'utf8'),
          join(directory, 'app/api/v1/content-drafts/[id]/revisions/[revisionId]/recover/route.ts')
        )
      }
      if (!scenario.ready) assert.match(result.stderr, /Draft recovery API did not become ready/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
