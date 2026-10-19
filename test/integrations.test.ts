import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { openCredentials, sealCredentials } from '@/lib/integrations/crypto'
import { deliverToFigma, deliverToNotion } from '@/lib/integrations/deliver'
import { authorizeUrl, refreshGrant } from '@/lib/integrations/providers'
import { parseFigmaUrl, providerOfSlug } from '@/lib/integrations/schema'

process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('base64')

type Call = { body: unknown; headers: Record<string, string>; method: string; url: string }

/** A fetch that records requests and answers from a script, in order. */
function scripted(answers: Array<(call: Call) => Response>) {
  const calls: Call[] = []
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = {
      body: init.body,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      method: init.method ?? 'GET',
      url: String(input),
    }
    calls.push(call)
    const answer = answers.shift()
    if (!answer) throw new Error(`Unexpected request to ${call.url}`)
    return answer(call)
  }) as typeof fetch
  return { calls, fetcher }
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })

const delivery = {
  altText: 'Dashboard with the new filters',
  bytes: new Uint8Array([137, 80, 78, 71]),
  fileName: 'launch.png',
  mediaType: 'image/png',
  shareUrl: 'https://shots.example/s/token',
  title: 'Launch',
}

test('credentials seal and open, and tampering is caught', () => {
  const sealed = sealCredentials({ accessToken: 'xoxb-secret', refreshToken: 'xoxe-refresh' })
  assert.ok(sealed.startsWith('v1.'))
  assert.ok(!sealed.includes('xoxb-secret'))
  assert.deepEqual(openCredentials(sealed), {
    accessToken: 'xoxb-secret',
    refreshToken: 'xoxe-refresh',
  })
  const parts = sealed.split('.')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => openCredentials(parts.join('.')))
})

test('consent URLs carry the client, scopes, redirect, and state', () => {
  const client = { id: 'client-1', secret: 'secret' }
  assert.throws(() => authorizeUrl('SLACK', client, 'https://x/cb', 's'), /backend/)
  const figma = new URL(authorizeUrl('FIGMA', client, 'https://x/cb', 's'))
  assert.equal(figma.searchParams.get('scope'), 'current_user:read file_comments:write')
  assert.equal(
    new URL(authorizeUrl('NOTION', client, 'https://x/cb', 's')).searchParams.get('owner'),
    'user'
  )
  assert.equal(providerOfSlug('notion'), 'NOTION')
})

test('Figma refreshes keep the refresh token when none is returned', async () => {
  const { calls, fetcher } = scripted([json({ access_token: 'figd-2', expires_in: 7776000 })])
  const refreshed = await refreshGrant(
    'FIGMA',
    { id: 'c', secret: 's' },
    {
      credentials: { accessToken: 'figd-1', refreshToken: 'r-1' },
      displayName: 'Ada',
      externalId: 'u1',
      scopes: [],
    },
    fetcher
  )
  assert.equal(refreshed?.credentials.accessToken, 'figd-2')
  assert.equal(refreshed?.credentials.refreshToken, 'r-1')
  assert.match(calls[0]!.headers.authorization ?? '', /^Basic /)
})

test('Notion delivery uploads the file and appends it with a bookmark', async () => {
  const { calls, fetcher } = scripted([
    json({ id: 'up-1' }),
    json({ status: 'uploaded' }),
    json({ results: [] }),
  ])
  const result = await deliverToNotion(
    'secret_1',
    delivery,
    { pageId: '1234567890abcdef1234567890abcdef' },
    fetcher
  )
  assert.equal(calls[1]!.url, 'https://api.notion.com/v1/file_uploads/up-1/send')
  assert.ok(calls[1]!.body instanceof FormData)
  const children = JSON.parse(String(calls[2]!.body)) as {
    children: Array<{ type: string; image?: { file_upload: { id: string } } }>
  }
  assert.deepEqual(
    children.children.map((block) => block.type),
    ['image', 'bookmark']
  )
  assert.equal(children.children[0]!.image?.file_upload.id, 'up-1')
  assert.equal(calls[2]!.headers['notion-version'], '2022-06-28')
  assert.equal(result.url, 'https://www.notion.so/1234567890abcdef1234567890abcdef')
})

test('Figma links parse to a file and frame; comments pin to the frame', async () => {
  assert.deepEqual(
    parseFigmaUrl('https://www.figma.com/design/AbC123xyz0/Launch?node-id=12-34&t=x'),
    { fileKey: 'AbC123xyz0', nodeId: '12:34' }
  )
  assert.deepEqual(parseFigmaUrl('https://figma.com/file/AbC123xyz0/Launch'), {
    fileKey: 'AbC123xyz0',
    nodeId: null,
  })
  assert.equal(parseFigmaUrl('https://evil.example/design/AbC123xyz0'), null)
  assert.equal(parseFigmaUrl('not a url'), null)
  const { calls, fetcher } = scripted([json({ id: 'comment-1' })])
  await deliverToFigma(
    'figd-1',
    delivery,
    { fileUrl: 'https://www.figma.com/design/AbC123xyz0/x?node-id=1-2' },
    fetcher
  )
  assert.equal(calls[0]!.url, 'https://api.figma.com/v1/files/AbC123xyz0/comments')
  const body = JSON.parse(String(calls[0]!.body)) as {
    client_meta: { node_id: string }
    message: string
  }
  assert.equal(body.client_meta.node_id, '1:2')
  assert.equal(body.message, `Launch\n${delivery.shareUrl}`)
  const denied = scripted([() => new Response('{}', { status: 403 })])
  await assert.rejects(
    deliverToFigma(
      'figd-1',
      delivery,
      { fileUrl: 'https://www.figma.com/design/AbC123xyz0/x' },
      denied.fetcher
    ),
    /access/
  )
})
