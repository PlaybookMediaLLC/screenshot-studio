/** How often a running launch run reports it is alive. */
export const HEARTBEAT_MS = 30_000

/** A run with heartbeats is dead once it misses this long; the backend uses the same window. */
const HEARTBEAT_STALE_MS = 2 * 60_000

/** A run without heartbeats (started before leases) is dead once it is this old. */
const STARTED_STALE_MS = 20 * 60_000

/** Whether a RUNNING run stopped without finishing: the server restarted or its lease lapsed. */
export function isRunStale(
  run: { heartbeatAt: Date | null; startedAt: Date },
  now = Date.now()
): boolean {
  return run.heartbeatAt
    ? now - run.heartbeatAt.getTime() > HEARTBEAT_STALE_MS
    : now - run.startedAt.getTime() > STARTED_STALE_MS
}
