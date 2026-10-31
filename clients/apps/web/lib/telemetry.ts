import { createHash, randomBytes } from 'node:crypto'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Histogram,
  type HrTime,
  type Meter,
} from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  hrTimeDuration,
  hrTimeToMilliseconds,
  W3CTraceContextPropagator,
} from '@opentelemetry/core'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { detectResources, envDetector, resourceFromAttributes } from '@opentelemetry/resources'
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import {
  BatchSpanProcessor,
  createAlwaysRecordSampler,
  ParentBasedSampler,
  SamplingDecision,
  TracerProvider,
  type ReadableSpan,
  type Sampler,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace'
import { z } from 'zod'

// OpenTelemetry for the Node.js server, with the sampling, promotion and
// redaction rules of the Go backend (server/internal/telemetry,
// docs/observability.md). The exporters read OTEL_EXPORTER_OTLP_* themselves.

const durationMs = z
  .string()
  .regex(/^(0|\d+(\.\d+)?(ms|s))$/, 'must be 0 or a duration such as 2s')
  .transform((value) =>
    value.endsWith('ms') ? Number(value.slice(0, -2)) : Number(value.slice(0, -1)) * 1000
  )
const count = (fallback: number) => z.coerce.number().int().positive().default(fallback)

const settingsSchema = z
  .object({
    OTEL_SAMPLING_RATE: z.coerce.number().min(0).max(1).default(0.01),
    OTEL_SLOW_SPAN_THRESHOLD: durationMs.default(2000),
    OTEL_PROMOTED_SPANS_PER_SECOND: z.coerce.number().min(0).max(10_000).default(10),
    OTEL_TRACES_EXPORTER: z.enum(['otlp', 'none']).default('otlp'),
    OTEL_METRICS_EXPORTER: z.enum(['otlp', 'none']).default('otlp'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: z.url().optional(),
    OTEL_BSP_MAX_QUEUE_SIZE: count(2048),
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: count(512),
    OTEL_BSP_SCHEDULE_DELAY: count(5000),
    OTEL_BSP_EXPORT_TIMEOUT: count(30_000),
    OTEL_METRIC_EXPORT_INTERVAL: count(60_000),
  })
  .superRefine((settings, issues) => {
    for (const signal of ['TRACES', 'METRICS'] as const) {
      const endpoint =
        settings.OTEL_EXPORTER_OTLP_ENDPOINT ?? settings[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]
      if (settings[`OTEL_${signal}_EXPORTER`] === 'otlp' && !endpoint) {
        issues.addIssue({
          code: 'custom',
          message: 'OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED=true',
        })
      }
    }
  })

type TelemetrySettings = z.infer<typeof settingsSchema>

/**
 * The telemetry settings, or null unless OTEL_ENABLED=true. An empty variable
 * counts as unset. Throws a ZodError on an invalid setting.
 */
export function telemetrySettings(env: Record<string, string | undefined>) {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
  const enabled = z.enum(['true', 'false']).default('false').parse(present.OTEL_ENABLED)
  return enabled === 'true' ? settingsSchema.parse(present) : null
}

/**
 * Samples rate of new traces. Next.js reads `traceparent` from every request,
 * browsers included, so a caller's sampled flag is not trusted: a remote
 * parent gets the same decision as a new trace. The decision hashes the trace
 * ID with a secret of this process, so a caller cannot pick an ID that is
 * always sampled; both Next.js passes of a request run here and agree. Every
 * span except a health check is recorded, so failed and slow spans can still
 * be kept and every request is measured.
 */
export function webSampler(rate: number): Sampler {
  const salt = randomBytes(16)
  const ratio: Sampler = {
    shouldSample: (_parent, traceId) => ({
      decision:
        createHash('sha256').update(salt).update(traceId).digest().readUInt32BE(0) < rate * 2 ** 32
          ? SamplingDecision.RECORD_AND_SAMPLED
          : SamplingDecision.NOT_RECORD,
    }),
    toString: () => `SaltedTraceIdRatio{${rate}}`,
  }
  const recorded = createAlwaysRecordSampler(
    new ParentBasedSampler({
      root: ratio,
      remoteParentSampled: ratio,
      remoteParentNotSampled: ratio,
    })
  )
  return {
    shouldSample: (parent, traceId, name, kind, attributes, links) =>
      String(attributes['http.target'] ?? '').startsWith('/api/health')
        ? { decision: SamplingDecision.NOT_RECORD }
        : recorded.shouldSample(parent, traceId, name, kind, attributes, links),
    toString: () => `WebSampler{${recorded.toString()}}`,
  }
}

/** A copy of span with changes; ReadableSpan has no other way to change one. */
function view(span: ReadableSpan, changes: Partial<ReadableSpan>): ReadableSpan {
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
    attributes: span.attributes,
    links: span.links,
    events: span.events,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    ...changes,
  }
}

const requestBuckets = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]

/**
 * Measures each routed or failed request, passes sampled spans to next, and
 * of the other traces passes the spans that failed or ran for at least
 * slowMs, at most perSecond a second. A kept span arrives without its
 * successful siblings.
 */
export class SpanRouter implements SpanProcessor {
  private readonly duration: Histogram
  // Start times of unrouted passes, by span ID, waiting for the next pass.
  // A redirect that proxy.ts answers leaves one behind; the oldest go first.
  private readonly passes = new Map<string, HrTime>()
  private readonly burst: number
  private tokens: number
  private refilled = Date.now()

  constructor(
    private readonly next: SpanProcessor | undefined,
    private readonly slowMs: number,
    private readonly perSecond: number,
    meter: Meter
  ) {
    this.burst = perSecond > 0 ? Math.max(1, 10 * perSecond) : 0
    this.tokens = this.burst
    this.duration = meter.createHistogram('http.server.request.duration', {
      unit: 's',
      advice: { explicitBucketBoundaries: requestBuckets },
    })
  }

  onStart(...args: Parameters<SpanProcessor['onStart']>) {
    this.next?.onStart(...args)
  }

  onEnd(span: ReadableSpan) {
    const ms = hrTimeToMilliseconds(span.duration)
    const status = Number(span.attributes['http.status_code'] ?? 0)
    if (
      span.kind === SpanKind.SERVER &&
      span.attributes['next.span_type'] === 'BaseServer.handleRequest'
    ) {
      this.measure(span, status)
    }
    if (!this.next) return
    if (span.spanContext().traceFlags & TraceFlags.SAMPLED) return this.next.onEnd(span)
    const failed = span.status.code === SpanStatusCode.ERROR || status >= 500
    const slow = this.slowMs > 0 && ms >= this.slowMs
    if ((failed || slow) && this.take()) {
      this.next.onEnd(
        view(span, {
          spanContext: () => ({ ...span.spanContext(), traceFlags: TraceFlags.SAMPLED }),
          attributes: { ...span.attributes, 'sampling.promoted': true },
        })
      )
    }
  }

  /**
   * A page request runs handleRequest up to three times in a row, each pass
   * the parent of the next: proxy.ts, a pass after a rewrite, then the render,
   * which has the route. The request is measured from the first pass to the
   * end of the render. A failed pass counts as a request. Responses that
   * proxy.ts answers itself (redirects, 406; their span reads 200) and
   * unrouted 404s are not counted.
   */
  private measure(span: ReadableSpan, status: number) {
    const parent = span.parentSpanContext?.spanId
    const start = (parent && this.passes.get(parent)) || span.startTime
    if (parent) this.passes.delete(parent)
    const route = span.attributes['http.route']
    if (!route && status < 500) {
      // Only proxy.ts passes, which Next.js marks next.bubble, lead to a render;
      // image and unrouted 404 passes are neither stored nor counted.
      if (span.attributes['next.bubble'] === true) {
        this.passes.set(span.spanContext().spanId, start)
        if (this.passes.size > 1000) this.passes.delete(this.passes.keys().next().value!)
      }
      return
    }
    this.duration.record(hrTimeToMilliseconds(hrTimeDuration(start, span.endTime)) / 1000, {
      'http.request.method': String(span.attributes['http.method'] ?? ''),
      'http.response.status_code': status,
      ...(route ? { 'http.route': String(route) } : {}),
    })
  }

  private take() {
    const now = Date.now()
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.refilled) / 1000) * this.perSecond
    )
    this.refilled = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  forceFlush() {
    return this.next?.forceFlush() ?? Promise.resolve()
  }

  shutdown() {
    return this.next?.shutdown() ?? Promise.resolve()
  }
}

// Personal data (client address, user agent) and the query string, which
// carries OAuth codes and tokens.
const dropped = new Set([
  'client.address',
  'network.peer.address',
  'network.peer.port',
  'net.peer.ip',
  'http.client_ip',
  'user_agent.original',
  'http.user_agent',
  'url.query',
])

// Credentials inside free text: query strings, URL user info, authorization
// headers and key=value pairs. Clients control the URLs these see, so each
// pattern runs in linear time: the query match starts at the `?` and looks
// back for a path, and the scheme length is bounded.
const secrets: [RegExp, string][] = [
  [/\?(?<=\/[^\s?#"'<>]*\?)[^\s#"'<>]*/g, '?REDACTED'],
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/)[^/\s@"'<>]+@/gi, '$1REDACTED@'],
  [/\b(bearer|basic)\s+[\w.~+/=-]+/gi, '$1 REDACTED'],
  [
    /\b(access_token|refresh_token|id_token|client_secret|password|api_?key|token|secret)=[^&\s"']+/gi,
    '$1=REDACTED',
  ],
]

/** Text with query strings and credentials replaced by REDACTED. */
export function scrub(text: string) {
  return secrets.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text
  )
}

function redact(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => !dropped.has(key))
      .map(([key, value]) => [key, typeof value === 'string' ? scrub(value) : value])
  )
}

/** An exporter that removes personal data and credentials before next sends spans. */
export function redacting(next: SpanExporter): SpanExporter {
  return {
    export: (spans, done) =>
      next.export(
        spans.map((span) =>
          view(span, {
            name: scrub(span.name),
            attributes: redact(span.attributes),
            events: span.events.map((event) => ({
              ...event,
              attributes: event.attributes && redact(event.attributes),
            })),
            status: { ...span.status, message: span.status.message && scrub(span.status.message) },
          })
        ),
        done
      ),
    shutdown: () => next.shutdown(),
    forceFlush: () => next.forceFlush?.() ?? Promise.resolve(),
  }
}

/** Event-loop delay, memory and CPU, read at each export. */
function observeRuntime(meter: Meter) {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  const p99 = meter.createObservableGauge('nodejs.eventloop.delay.p99', { unit: 's' })
  const max = meter.createObservableGauge('nodejs.eventloop.delay.max', { unit: 's' })
  const memory = meter.createObservableGauge('process.memory.usage', { unit: 'By' })
  const cpu = meter.createObservableCounter('process.cpu.time', { unit: 's' })
  meter.addBatchObservableCallback(
    (result) => {
      result.observe(p99, delay.percentile(99) / 1e9)
      result.observe(max, delay.max / 1e9)
      delay.reset()
      result.observe(memory, process.memoryUsage.rss())
      const usage = process.cpuUsage()
      result.observe(cpu, (usage.user + usage.system) / 1e6)
    },
    [p99, max, memory, cpu]
  )
}

function start(settings: TelemetrySettings) {
  const resource = resourceFromAttributes({
    'service.name': 'shots-web',
    ...(process.env.NEXT_DEPLOYMENT_ID
      ? { 'service.version': process.env.NEXT_DEPLOYMENT_ID }
      : {}),
  }).merge(detectResources({ detectors: [envDetector] }))
  const meterProvider =
    settings.OTEL_METRICS_EXPORTER === 'otlp'
      ? new MeterProvider({
          resource,
          readers: [
            new PeriodicExportingMetricReader({
              // Delta, as the Go services and the other Axiom datasets.
              exporter: new OTLPMetricExporter({
                temporalityPreference: AggregationTemporality.DELTA,
              }),
              exportIntervalMillis: settings.OTEL_METRIC_EXPORT_INTERVAL,
            }),
          ],
        })
      : undefined
  // The batch processor exports in the background from a bounded queue and
  // drops spans when it is full.
  const batch =
    settings.OTEL_TRACES_EXPORTER === 'otlp'
      ? new BatchSpanProcessor({
          exporter: redacting(new OTLPTraceExporter()),
          maxQueueSize: settings.OTEL_BSP_MAX_QUEUE_SIZE,
          maxExportBatchSize: settings.OTEL_BSP_MAX_EXPORT_BATCH_SIZE,
          scheduledDelayMillis: settings.OTEL_BSP_SCHEDULE_DELAY,
          exportTimeoutMillis: settings.OTEL_BSP_EXPORT_TIMEOUT,
        })
      : undefined
  const meter = (meterProvider ?? metrics.getMeterProvider()).getMeter('shots-web')
  const tracerProvider = new TracerProvider({
    resource,
    sampler: webSampler(settings.OTEL_SAMPLING_RATE),
    spanLimits: { attributeValueLengthLimit: 2048 },
    spanProcessors: [
      new SpanRouter(
        batch,
        settings.OTEL_SLOW_SPAN_THRESHOLD,
        settings.OTEL_PROMOTED_SPANS_PER_SECOND,
        meter
      ),
    ],
  })
  // Export failures go to diag; without a logger they would be silent.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  trace.setGlobalTracerProvider(tracerProvider)
  if (meterProvider) {
    metrics.setGlobalMeterProvider(meterProvider)
    observeRuntime(meter)
  }
  // Flush, not shut down, so spans of requests Next.js still finishes reach
  // the queue. ponytail: Next.js exits without waiting for this flush, so the
  // spans and metrics not yet exported can be lost: up to one
  // OTEL_BSP_SCHEDULE_DELAY of spans and one OTEL_METRIC_EXPORT_INTERVAL of
  // metrics. Owning shutdown (NEXT_MANUAL_SIG_HANDLE) would fix it.
  process.once('SIGTERM', () => {
    void Promise.allSettled([tracerProvider.forceFlush(), meterProvider?.forceFlush()])
  })
}

/**
 * Starts OpenTelemetry when OTEL_ENABLED=true. A bad setting is logged and
 * leaves telemetry off; it never stops the server.
 */
export function startTelemetry() {
  try {
    const settings = telemetrySettings(process.env)
    if (!settings) return
    start(settings)
  } catch (error) {
    console.error(
      '[telemetry] disabled:',
      error instanceof z.ZodError ? z.prettifyError(error) : error
    )
  }
}
