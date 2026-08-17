import { createServer } from 'node:http'

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL6fQAAAABJRU5ErkJggg==',
  'base64'
)
const imageUrl = 'http://screenshot-mock:5678/image'

function getPayload(sourceUrl) {
  if (sourceUrl.includes('/timeout')) {
    return { body: { data: { message: 'timeout' }, status: 'error' }, status: 504 }
  }
  if (sourceUrl.includes('/unavailable')) {
    return { body: { data: { message: 'connection_error' }, status: 'error' }, status: 429 }
  }
  if (sourceUrl.includes('/invalid-image')) {
    return { body: { data: { screenshot: { url: 'data:text/plain,invalid' } }, status: 'success' }, status: 200 }
  }
  if (sourceUrl.includes('/redirect-private')) {
    const port = new URL(sourceUrl).searchParams.get('port') || '5680'
    return {
      body: {
        data: { screenshot: { url: `http://host.docker.internal:${port}/redirect-private` } },
        status: 'success',
      },
      status: 200,
    }
  }
  if (sourceUrl.includes('/oversized-image')) {
    const port = new URL(sourceUrl).searchParams.get('port') || '5680'
    return {
      body: {
        data: { screenshot: { url: `http://host.docker.internal:${port}/oversized-image` } },
        status: 'success',
      },
      status: 200,
    }
  }

  return { body: { data: { screenshot: { url: imageUrl } }, status: 'success' }, status: 200 }
}

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)
    if (requestUrl.pathname === '/image') {
      response.writeHead(200, {
        'content-length': image.length,
        'content-type': 'image/png',
      })
      response.end(image)
      return
    }
    const payload = getPayload(requestUrl.searchParams.get('url') ?? '')
    response.writeHead(payload.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload.body))
  } catch (error) {
    console.error('screenshot-mock request failed:', error)
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: { message: String(error) }, status: 'error' }))
  }
})

server.listen(5678, '0.0.0.0', () => {
  console.log('screenshot-mock listening on 5678')
})
