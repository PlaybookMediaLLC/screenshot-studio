/** Never prerender: the probe must reach a live process. */
export const dynamic = 'force-dynamic'

/** Liveness probe for the load balancer and the local stack. */
export function GET(): Response {
  return Response.json({ status: 'ok' })
}
