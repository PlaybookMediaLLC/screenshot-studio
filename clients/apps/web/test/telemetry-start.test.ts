import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { trace } from '@opentelemetry/api'
import { startTelemetry } from '../lib/telemetry'

// startTelemetry registers global providers, so these tests run in their own
// process (one per test file) and in this order.

const requests: { path: string; headers: IncomingHttpHeaders }[] = []
const receiver = createServer((request, response) => {
  requests.push({ path: request.url ?? '', headers: request.headers })
  request.resume()
  request.on('end', () => response.end())
})

test.before(() => new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve)))
test.after(() => receiver.close())

test('a bad setting leaves telemetry off and the server running', (t) => {
  const error = t.mock.method(console, 'error', () => {})
  process.env.OTEL_ENABLED = 'true'
  process.env.OTEL_SAMPLING_RATE = '2'
  assert.doesNotThrow(() => startTelemetry())
  assert.equal(error.mock.callCount(), 1)
  assert.equal(trace.getTracer('test').startSpan('request').isRecording(), false)
})

test('enabled telemetry exports through the configured batch and flushes on SIGTERM', async () => {
  const { port } = receiver.address() as AddressInfo
  Object.assign(process.env, {
    OTEL_ENABLED: 'true',
    OTEL_SAMPLING_RATE: '1',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
    OTEL_EXPORTER_OTLP_TRACES_HEADERS:
      'authorization=Bearer xaat-test,x-axiom-dataset=shots-traces',
    OTEL_EXPORTER_OTLP_METRICS_HEADERS:
      'authorization=Bearer xaat-test,x-axiom-metrics-dataset=shots-metrics',
    OTEL_EXPORTER_OTLP_COMPRESSION: 'gzip',
    // Two spans a batch and no timed export: of three spans, the third
    // leaves only when SIGTERM flushes.
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '2',
    OTEL_BSP_SCHEDULE_DELAY: '600000',
  })
  startTelemetry()
  for (let i = 0; i < 3; i++) trace.getTracer('test').startSpan('request').end()
  const traces = () => requests.filter((request) => request.path === '/v1/traces')
  const metrics = () => requests.filter((request) => request.path === '/v1/metrics')
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 10_000
    while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await until(() => traces().length >= 1)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(traces().length, 1, 'the full batch only, before SIGTERM')
  assert.equal(metrics().length, 0)

  process.emit('SIGTERM')
  await until(() => traces().length >= 2 && metrics().length >= 1)
  assert.equal(traces().length, 2, 'SIGTERM flushes the last span')
  assert.equal(traces()[0].headers.authorization, 'Bearer xaat-test')
  assert.equal(traces()[0].headers['x-axiom-dataset'], 'shots-traces')
  assert.equal(traces()[0].headers['content-encoding'], 'gzip')
  assert.equal(metrics()[0].headers['x-axiom-metrics-dataset'], 'shots-metrics')
})
