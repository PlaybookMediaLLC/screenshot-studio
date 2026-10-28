import { once } from 'node:events'
import {
  createServer,
  request as forward,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { z } from 'zod'
import { createE2EDatabase } from './services'

/**
 * The social API mock, shared by parallel workers.
 *
 * The backend has one social API address (dev/studio's SOCIAL_API_URL, port
 * 5679), and every workspace binding sends its secret's token. Each worker
 * binds its workspaces to its own secret reference, SOCIAL_API_KEY_E2E_W<n>,
 * whose token is `e2e-social-w<n>`. The router on 5679 forwards a request to
 * the mock of the worker its token names, which answers with the handler of
 * the test running there. An OAuth callback carries no token, so the router
 * finds its worker from the secret reference of the callback's OAuth state.
 */

/** Where the backend sends social API calls. */
const SOCIAL_ROUTER_PORT = Number(process.env.E2E_SOCIAL_MOCK_PORT ?? 5679)
/** dev/studio gives the backend this many worker secrets. */
const SOCIAL_WORKER_SLOTS = 8

export function socialSecretReference(slot: number): string {
  if (slot >= SOCIAL_WORKER_SLOTS) {
    throw new Error(
      `dev/studio provisions ${SOCIAL_WORKER_SLOTS} worker social secrets; run at most ${SOCIAL_WORKER_SLOTS} workers.`
    )
  }
  return `SOCIAL_API_KEY_E2E_W${slot}`
}

/** Worker n's mock listens on 5690 + n. */
export function socialWorkerPort(slot: number): number {
  return 5690 + slot
}

const callbackSchema = z.object({ state: z.string().min(1) })
const unroutedSchema = z.array(z.object({ method: z.string(), url: z.string() }))

/**
 * Social API requests the router could give to no worker: a wrong or missing
 * credential. A test proves a call was never made by not finding it here.
 */
export async function unroutedSocialRequests(): Promise<z.infer<typeof unroutedSchema>> {
  const response = await fetch(`http://127.0.0.1:${SOCIAL_ROUTER_PORT}/__e2e/unrouted`)
  return unroutedSchema.parse(await response.json())
}

/** Started once by Playwright's global setup. Returns the teardown. */
export default async function startSocialRouter(): Promise<() => Promise<void>> {
  const database = createE2EDatabase()
  // The router runs in the Playwright runner process: an unhandled error there ends the run.
  database.on('error', () => {})
  const unrouted: z.infer<typeof unroutedSchema> = []
  const slotOf = async (authorization: string, body: Buffer): Promise<string | undefined> => {
    const token = /^e2e-social-w(\d+)$/.exec(authorization)?.[1]
    if (token !== undefined) return token
    let state: string
    try {
      state = callbackSchema.parse(JSON.parse(body.toString())).state
    } catch {
      return undefined
    }
    const row = await database.query<{ secretReference: string }>(
      'SELECT "secretReference" FROM social_oauth_start WHERE state = $1',
      [state]
    )
    return /^SOCIAL_API_KEY_E2E_W(\d+)$/.exec(row.rows[0]?.secretReference ?? '')?.[1]
  }

  const server = createServer((request, response) => {
    route(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
  })
  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.url === '/__e2e/unrouted') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(unrouted))
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)
    const slot = await slotOf(request.headers.authorization ?? '', body).catch(() => undefined)
    if (slot === undefined) {
      unrouted.push({ method: request.method ?? 'GET', url: request.url ?? '' })
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Bind the workspace with the e2e worker secret.' }))
      return
    }
    const upstream = forward(
      {
        headers: request.headers,
        host: '127.0.0.1',
        method: request.method,
        path: request.url,
        port: socialWorkerPort(Number(slot)),
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
      }
    )
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    upstream.end(body)
  }
  // All interfaces: the backend reaches the router through host.docker.internal.
  server.listen(SOCIAL_ROUTER_PORT)
  await once(server, 'listening')
  return async () => {
    await new Promise((resolve) => server.close(resolve))
    await database.end()
  }
}
