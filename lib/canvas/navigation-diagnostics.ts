/** Redacted diagnostics for failed Canvas page-data requests; never include document IDs or query values. */
export function canvasNavigationFailure(
  entry: { name: string; responseStatus?: number; duration: number },
  origin: string
) {
  if (!entry.responseStatus || entry.responseStatus < 500) return null
  let url: URL
  try {
    url = new URL(entry.name)
  } catch {
    return null
  }
  if (url.origin !== origin || !url.searchParams.has('_rsc')) return null
  const path = url.pathname.replace(/^\/(en|es|fr|de|ja|pt|ko|zh)(?=\/)/, '')
  const route =
    path === '/canvas'
      ? '/canvas'
      : path === '/canvas/new'
        ? '/canvas/new'
        : /^\/canvas\/[^/]+$/.test(path)
          ? '/canvas/[canvasId]'
          : null
  if (!route) return null
  return { route, status: entry.responseStatus, duration_ms: Math.round(entry.duration) }
}
