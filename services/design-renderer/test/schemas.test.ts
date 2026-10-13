import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { environmentSchema, renderRequestSchema, renderResultSchema } from '../src/schemas.js'

const env = {
  RENDER_ALLOWED_ORIGIN: 'https://app.example.com',
  RENDER_SERVICE_SECRET: 'test-secret-0123456789-abcdefghij',
}

test('configuration has typed defaults and supports a zero-length queue', () => {
  const config = environmentSchema.parse(env)
  assert.equal(config.port, 8080)
  assert.equal(config.concurrency, 2)
  assert.equal(config.queueTimeoutMs, 10000)
  assert.equal(environmentSchema.parse({ ...env, RENDER_MAX_QUEUE: '0' }).maxQueue, 0)
})

test('rejects invalid configuration instead of starting a broken service', () => {
  for (const overrides of [
    { RENDER_SERVICE_SECRET: 'short' },
    { RENDER_SERVICE_SECRET: ' '.repeat(32) },
    { RENDER_ALLOWED_ORIGIN: 'file:///tmp' },
    { RENDER_ALLOWED_ORIGIN: 'https://app.example.com/path' },
    { RENDER_ALLOWED_ORIGIN: 'https://user:pass@app.example.com' },
    { RENDER_ALLOWED_ORIGIN: '' },
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: 'nope' },
    { RENDER_CONCURRENCY: '0' },
    { RENDER_CONCURRENCY: '1.5' },
    { RENDER_MAX_QUEUE: '-1' },
    { RENDER_QUEUE_TIMEOUT_MS: '0' },
    { RENDER_TIMEOUT_MS: '' },
    { RENDER_RECYCLE_AFTER: '0' },
    { RENDER_SHUTDOWN_TIMEOUT_MS: '0' },
  ])
    assert.equal(
      environmentSchema.safeParse({ ...env, ...overrides }).success,
      false,
      JSON.stringify(overrides)
    )
})

test('validates request URLs and export contracts', () => {
  assert.equal(
    renderRequestSchema.safeParse({ url: 'https://app.example.com/render/abc?token=t' }).success,
    true
  )
  assert.equal(
    renderRequestSchema.safeParse({ url: 'https://user:pass@app.example.com/render/abc' }).success,
    false
  )
  assert.equal(renderResultSchema.safeParse({ base64: 'aGk=', width: 1, height: 1 }).success, true)
  for (const overrides of [
    { width: 0 },
    { height: 1.2 },
    { base64: '' },
    { base64: 'bad' },
    { mediaType: 'text/html' },
  ]) {
    assert.equal(
      renderResultSchema.safeParse({ base64: 'aGk=', width: 1, height: 1, ...overrides }).success,
      false
    )
  }
})

test('invalid startup reports field names and exits without exposing secrets', () => {
  const result = spawnSync(
    process.execPath,
    [new URL('../dist/server.js', import.meta.url).pathname],
    {
      env: { ...process.env, ...env, PORT: '-1' },
      encoding: 'utf8',
      timeout: 5000,
    }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PORT/)
  assert.ok(!result.stderr.includes(env.RENDER_SERVICE_SECRET))
})
