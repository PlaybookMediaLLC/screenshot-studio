import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Span,
} from '@opentelemetry/api'
import { MeterProvider, MetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics'
import {
  InMemorySpanExporter,
  SamplingDecision,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace'
import { redacting, scrub, SpanRouter, telemetrySettings, webSampler } from '../lib/telemetry'

class TestReader extends MetricReader {
  protected onShutdown() {
    return Promise.resolve()
  }
  protected onForceFlush() {
    return Promise.resolve()
  }
}

const endpoint = { OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://api.axiom.co' }

test('telemetry is off unless enabled, without validating the rest', () => {
  assert.equal(telemetrySettings({}), null)
  assert.equal(telemetrySettings({ OTEL_ENABLED: '', OTEL_SAMPLING_RATE: 'oops' }), null)
})

test('enabled telemetry samples 1% of new traces by default', () => {
  const settings = telemetrySettings(endpoint)
  assert.equal(settings?.OTEL_SAMPLING_RATE, 0.01)
  assert.equal(settings?.OTEL_SLOW_SPAN_THRESHOLD, 2000)
  assert.equal(settings?.OTEL_PROMOTED_SPANS_PER_SECOND, 10)
  assert.equal(
    telemetrySettings({ ...endpoint, OTEL_SLOW_SPAN_THRESHOLD: '500ms' })?.OTEL_SLOW_SPAN_THRESHOLD,
    500
  )
  // 0 keeps no slow spans, as in Go.
  assert.equal(
    telemetrySettings({ ...endpoint, OTEL_SLOW_SPAN_THRESHOLD: '0' })?.OTEL_SLOW_SPAN_THRESHOLD,
    0
  )
})

test('invalid telemetry settings are rejected', () => {
  for (const env of [
    { OTEL_EXPORTER_OTLP_ENDPOINT: '' },
    { OTEL_SAMPLING_RATE: '1.5' },
    { OTEL_SAMPLING_RATE: '1%' },
    { OTEL_SLOW_SPAN_THRESHOLD: '2' },
    { OTEL_PROMOTED_SPANS_PER_SECOND: '-1' },
    { OTEL_TRACES_EXPORTER: 'jaeger' },
    { OTEL_ENABLED: 'yes' },
  ]) {
    assert.throws(() => telemetrySettings({ ...endpoint, ...env }), JSON.stringify(env))
  }
})

test('each signal turns off on its own', () => {
  const settings = telemetrySettings({
    OTEL_ENABLED: 'true',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://api.axiom.co/v1/traces',
    OTEL_METRICS_EXPORTER: 'none',
  })
  assert.equal(settings?.OTEL_TRACES_EXPORTER, 'otlp')
  assert.equal(settings?.OTEL_METRICS_EXPORTER, 'none')
})

const randomTraceId = () =>
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

test('the web samples about 1% of new traces and records the rest', () => {
  const sampler = webSampler(0.01)
  let sampled = 0
  for (let i = 0; i < 20_000; i++) {
    const { decision } = sampler.shouldSample(
      ROOT_CONTEXT,
      randomTraceId(),
      'GET',
      SpanKind.SERVER,
      {},
      []
    )
    if (decision === SamplingDecision.RECORD_AND_SAMPLED) sampled++
    else assert.equal(decision, SamplingDecision.RECORD)
  }
  // About 200 are expected; the bounds are about six standard deviations.
  assert.ok(sampled > 120 && sampled < 280, `sampled ${sampled} of 20000`)
})

test('a caller cannot force its request into the sample, and health checks are not recorded', () => {
  const sampler = webSampler(0)
  const caller = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: randomTraceId(),
    spanId: '00f067aa0ba902b7',
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  })
  const call = (attributes = {}) =>
    sampler.shouldSample(caller, randomTraceId(), 'GET', SpanKind.SERVER, attributes, []).decision
  assert.equal(call(), SamplingDecision.RECORD)
  assert.equal(call({ 'http.target': '/api/health' }), SamplingDecision.NOT_RECORD)
})

test('a caller cannot pick trace IDs that are always sampled', () => {
  // These IDs all pass a plain trace-ID ratio sampler at 1%.
  const sampler = webSampler(0.01)
  let sampled = 0
  for (let i = 1; i <= 1000; i++) {
    const traceId = i.toString(16).padStart(8, '0') + '0'.repeat(24)
    const caller = trace.setSpanContext(ROOT_CONTEXT, {
      traceId,
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.NONE,
      isRemote: true,
    })
    const result = sampler.shouldSample(caller, traceId, 'GET', SpanKind.SERVER, {}, [])
    if (result.decision === SamplingDecision.RECORD_AND_SAMPLED) sampled++
  }
  assert.ok(sampled < 50, `sampled ${sampled} of 1000 chosen trace IDs`)
})

test('both passes of one request get the same decision', () => {
  const sampler = webSampler(0.5)
  for (let i = 0; i < 100; i++) {
    const traceId = randomTraceId()
    const decide = () =>
      sampler.shouldSample(ROOT_CONTEXT, traceId, 'GET', SpanKind.SERVER, {}, []).decision
    assert.equal(decide(), decide())
  }
})

test('scrubbing a URL a client chose takes linear time', () => {
  for (const text of ['/'.repeat(2048), '/' + 'x.'.repeat(1023), 'a:'.repeat(1024)]) {
    const started = performance.now()
    for (let i = 0; i < 20; i++) scrub(text)
    assert.ok(performance.now() - started < 20, `20 scrubs of ${text.slice(0, 8)}… were slow`)
  }
})

function setup(rate: number, slowMs: number, perSecond: number) {
  const exporter = new InMemorySpanExporter()
  const reader = new TestReader()
  const router = new SpanRouter(
    new SimpleSpanProcessor({ exporter }),
    slowMs,
    perSecond,
    new MeterProvider({ readers: [reader] }).getMeter('test')
  )
  const provider = new TracerProvider({ sampler: webSampler(rate), spanProcessors: [router] })
  return { exporter, reader, tracer: provider.getTracer('test') }
}

test('failed and slow spans of unsampled traces are kept and marked', () => {
  const { exporter, tracer } = setup(0, 1000, 100)
  const start = Date.now()
  tracer.startSpan('fast', { startTime: start }).end(start + 1)
  tracer.startSpan('slow', { startTime: start }).end(start + 2000)
  const failed = tracer.startSpan('failed')
  failed.setStatus({ code: SpanStatusCode.ERROR })
  failed.end()
  tracer.startSpan('fetch GET', { attributes: { 'http.status_code': 503 } }).end()
  const kept = exporter.getFinishedSpans()
  assert.deepEqual(kept.map((span) => span.name).sort(), ['failed', 'fetch GET', 'slow'])
  for (const span of kept) {
    assert.equal(span.spanContext().traceFlags & TraceFlags.SAMPLED, TraceFlags.SAMPLED)
    assert.equal(span.attributes['sampling.promoted'], true)
  }
})

test('kept spans of unsampled traces are rate limited', () => {
  // One a second allows a burst of ten.
  const { exporter, tracer } = setup(0, 0, 1)
  for (let i = 0; i < 100; i++) {
    const span = tracer.startSpan('failed')
    span.setStatus({ code: SpanStatusCode.ERROR })
    span.end()
  }
  const kept = exporter.getFinishedSpans().length
  assert.ok(kept >= 10 && kept <= 11, `kept ${kept}`)
})

test('each request is measured once, from proxy.ts to the end of its render', async () => {
  const { reader, tracer } = setup(0, 0, 0)
  const pass = (start: number, end: number, attributes: Attributes, parent?: Span) => {
    const span = tracer.startSpan(
      'GET',
      {
        kind: SpanKind.SERVER,
        startTime: start,
        attributes: {
          'next.span_type': 'BaseServer.handleRequest',
          'http.method': 'GET',
          ...attributes,
        },
      },
      parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT
    )
    span.end(end)
    return span
  }
  const t = Date.now()
  // A page: proxy.ts, a pass after its rewrite, then the render, each the
  // parent of the next. It took 2 seconds from the first pass.
  const proxy = pass(t, t + 2, { 'http.status_code': 200, 'next.bubble': true })
  const rewrite = pass(t + 4, t + 5, { 'http.status_code': 200, 'next.bubble': true }, proxy)
  pass(t + 6, t + 2000, { 'http.status_code': 200, 'http.route': '/[locale]/home' }, rewrite)
  // proxy.ts answers a redirect itself: its span reads 200 and is not counted.
  pass(t, t + 1, { 'http.status_code': 200 })
  // proxy.ts fails: counted, without a route.
  pass(t, t + 3, { 'http.status_code': 502 })
  // An API route runs one pass.
  pass(t, t + 50, { 'http.status_code': 200, 'http.route': '/api/v1/me' })

  const { resourceMetrics } = await reader.collect()
  const metric = resourceMetrics.scopeMetrics[0].metrics[0] as HistogramMetricData
  assert.equal(metric.descriptor.name, 'http.server.request.duration')
  const series = Object.fromEntries(
    metric.dataPoints.map((point) => [
      `${point.attributes['http.route'] ?? '-'} ${point.attributes['http.response.status_code']}`,
      [point.value.count, point.value.sum],
    ])
  )
  assert.deepEqual(Object.keys(series).sort(), ['- 502', '/[locale]/home 200', '/api/v1/me 200'])
  assert.deepEqual(series['/[locale]/home 200'], [1, 2])
  assert.deepEqual(series['/api/v1/me 200'], [1, 0.05])
})

test('a local child span follows its parent', () => {
  for (const [rate, sampled] of [
    [1, true],
    [0, false],
  ] as const) {
    const tracer = new TracerProvider({ sampler: webSampler(rate) }).getTracer('test')
    const parent = tracer.startSpan('GET')
    const child = tracer.startSpan('fetch', {}, trace.setSpan(ROOT_CONTEXT, parent))
    assert.equal(Boolean(child.spanContext().traceFlags & TraceFlags.SAMPLED), sampled)
    assert.equal(child.isRecording(), true)
  }
})

test('exported spans lose personal data, query strings and credentials', async () => {
  const exporter = new InMemorySpanExporter()
  const provider = new TracerProvider({
    sampler: webSampler(1),
    spanProcessors: [new SimpleSpanProcessor({ exporter: redacting(exporter) })],
  })
  const span = provider
    .getTracer('test')
    .startSpan('fetch GET https://api.example.com/v1/me?key=s3cr3t-key', {
      attributes: {
        'http.target': '/api/auth/callback?code=s3cr3t-code&state=s3cr3t-state',
        'http.url': 'https://user:s3cr3t-pass@api.example.com/v1/me',
        'client.address': '203.0.113.7',
        'http.user_agent': 'Mozilla/5.0',
        'http.method': 'GET',
      },
    })
  span.recordException(new Error('auth failed: Bearer s3cr3t-bearer; client_secret=s3cr3t-client'))
  span.setStatus({ code: SpanStatusCode.ERROR, message: 'token=s3cr3t-status' })
  span.end()
  await provider.forceFlush()
  const [exported] = exporter.getFinishedSpans()
  const text = JSON.stringify([
    exported.name,
    exported.attributes,
    exported.events,
    exported.status,
  ])
  assert.doesNotMatch(text, /s3cr3t|203\.0\.113\.7|Mozilla/)
  assert.equal(exported.attributes['http.target'], '/api/auth/callback?REDACTED')
  assert.equal(exported.attributes['http.url'], 'https://REDACTED@api.example.com/v1/me')
  assert.equal(exported.attributes['http.method'], 'GET')
  assert.equal(exported.name, 'fetch GET https://api.example.com/v1/me?REDACTED')
})
