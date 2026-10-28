import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const studio = readFileSync('../../../dev/studio', 'utf8')
const recoveryCheck = studio.slice(
  studio.indexOf('warm_recovery_route() {'),
  studio.indexOf('run_e2e() {')
)

test('each lane reloads the plain-node mock without forcing backend recreation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-lanes-'))
  const start = studio.slice(
    studio.indexOf('start_e2e_app() {'),
    studio.indexOf('warm_e2e_routes() {')
  )
  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `
      set -euo pipefail
      compose() { printf '%s\\n' "$*" >> commands; }
      wait_for_screenshot_mock() { :; }
      wait_for_http() { :; }
      ${start}
      start_e2e_app production http://localhost:3000 http://localhost:3000
      start_e2e_app dev-server http://localhost:3000 http://localhost:3000
    `,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, ROOT_DIR: directory, E2E_APP_IMAGE_READY: 'true' },
        timeout: 5000,
      }
    )
    assert.equal(result.status, 0, result.stderr)
    const commands = readFileSync(join(directory, 'commands'), 'utf8').trim().split('\n')
    const forced = commands.filter((command) => command.includes('--force-recreate'))
    assert.deepEqual(forced, [
      '--profile e2e up --detach --force-recreate screenshot-mock',
      '--profile e2e up --detach --force-recreate screenshot-mock',
    ])
    const starts = commands.filter((command) => command.endsWith('publishing-orchestrator app'))
    assert.equal(starts.length, 2)
    assert.match(starts[0]!, /compose.e2e.yaml/)
    assert.doesNotMatch(starts[1]!, /compose.e2e.yaml/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

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
            WEB_DIR: directory,
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
