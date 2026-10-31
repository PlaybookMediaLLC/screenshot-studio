// Starts OpenTelemetry on the Node.js server when OTEL_ENABLED=true
// (docs/observability.md). Edge code is not traced.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startTelemetry } = await import('./lib/telemetry')
    startTelemetry()
  }
}
