import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('release automation fixture accepts only local test services and writes private configuration', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'release-automation-fixture-'))
  const runner = path.resolve('test/e2e/framework/release-automation-stack.mjs')
  const env = {
    ...process.env,
    E2E_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:55439/release_test',
    E2E_REDIS_URL: 'redis://127.0.0.1:63809',
    E2E_R2_ENDPOINT: 'http://127.0.0.1:9013',
    E2E_R2_ACCESS_KEY_ID: 'fixture',
    E2E_R2_SECRET_ACCESS_KEY: 'fixture',
    E2E_R2_BUCKET_NAME: 'fixture',
    E2E_BASE_URL: 'http://localhost:3049',
    TEMPORAL_ADDRESS: '127.0.0.1:7253',
  }
  try {
    const ready = spawnSync(process.execPath, [runner, 'prepare'], { cwd, env, encoding: 'utf8' })
    assert.equal(ready.status, 0, ready.stderr)
    const file = path.join(cwd, '.context/release-automation-fixture.json')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const config = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(config.GITHUB_APP_WEBHOOK_SECRET, config.E2E_GITHUB_WEBHOOK_SECRET)
    assert.notEqual(config.BETTER_AUTH_SECRET, config.PUBLISHING_SERVICE_TOKEN)
    assert.equal(config.RESEND_API_KEY, '')
    assert.equal(config.OPENAI_API_KEY, '')
    assert.ok(!ready.stdout.includes(config.GITHUB_APP_WEBHOOK_SECRET))
    for (const invalid of [
      { E2E_DATABASE_URL: 'postgresql://fixture:fixture@database.example.com/release_test' },
      { E2E_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/production' },
      { TEMPORAL_ADDRESS: 'temporal.example.com:7233' },
    ]) {
      const rejected = spawnSync(process.execPath, [runner, 'prepare'], {
        cwd,
        env: { ...env, ...invalid },
        encoding: 'utf8',
      })
      assert.notEqual(rejected.status, 0)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
