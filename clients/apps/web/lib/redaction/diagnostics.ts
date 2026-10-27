let users = 0
let original: typeof console.error | null = null
const diagnostic = (...args: unknown[]) => {
  const message = args.map(String).join(' ')
  // Native informational logs must retain their real severity rather than appear as failures.
  // eslint-disable-next-line no-console
  if (/^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.?$/.test(message) || /^I\d+ .*gl_context/.test(message) || /GL error checking is disabled/.test(message)) console.info(...args)
  else original?.(...args)
}

/** MediaPipe sends native INFO to stderr. Reclassify only known diagnostics during scans. */
export async function withMediaPipeDiagnostics<T>(run: () => Promise<T>): Promise<T> {
  if (users++ === 0) { original = console.error; console.error = diagnostic }
  try { return await run() } finally {
    if (--users === 0) {
      if (console.error === diagnostic && original) console.error = original
      original = null
    }
  }
}
