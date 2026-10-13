import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

// State contains receipts only. Never expose credentials or signed media URLs.
const state = { mode: 'normal', requests: 0, posts: [] }
const mediaOrigin = process.env.POSTIZ_E2E_MEDIA_ORIGIN

function reply(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'Content-Length': bytes.length,
    'Content-Type': 'application/json',
  })
  response.end(bytes)
}

async function readJSON(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function mediaReceipt(item) {
  const url = new URL(item.path)
  if (url.origin !== mediaOrigin || !url.searchParams.has('X-Amz-Signature')) {
    throw new Error('unsigned or unexpected media')
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('media fetch failed')
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    bytes: bytes.length,
    contentType: response.headers.get('content-type'),
    expires: url.searchParams.get('X-Amz-Expires'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signedAt: url.searchParams.get('X-Amz-Date'),
  }
}

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (request.method === 'GET' && path === '/health')
      return reply(response, 200, { status: 'ok' })
    if (request.method === 'GET' && path === '/state') return reply(response, 200, state)
    if (request.method === 'POST' && path === '/control') {
      const { mode } = await readJSON(request)
      if (!['normal', 'throttle-once', 'server-error-once'].includes(mode)) {
        return reply(response, 400, { error: 'invalid mode' })
      }
      Object.assign(state, { mode, posts: [], requests: 0 })
      return reply(response, 200, { ok: true })
    }
    if (request.method !== 'POST' || path !== '/posts') {
      return reply(response, 404, { error: 'not found' })
    }

    const body = await readJSON(request)
    state.requests++
    if (body.accessToken !== 'valid') return reply(response, 401, { error: 'expired credential' })
    if (state.requests === 1 && state.mode === 'throttle-once') {
      return reply(response, 429, { error: 'rate limited' })
    }
    if (state.requests === 1 && state.mode === 'server-error-once') {
      return reply(response, 500, { error: 'temporary failure' })
    }
    const media = await Promise.all((body.post?.media ?? []).map(mediaReceipt))
    const remoteId = `fake-remote-${state.posts.length + 1}`
    state.posts.push({
      caption: body.post?.message,
      id: remoteId,
      media,
      sourceId: body.id,
    })
    return reply(response, 201, {
      postId: remoteId,
      releaseURL: `https://fake-social.invalid/posts/${remoteId}`,
    })
  } catch {
    return reply(response, 422, { error: 'invalid social request or media' })
  }
}).listen(8080, '0.0.0.0')
