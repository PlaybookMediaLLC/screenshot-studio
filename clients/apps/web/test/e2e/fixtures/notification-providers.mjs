// Backend provider sinks; authentication, business writes and dispatch stay real.
import assert from 'node:assert/strict'
import { URLSearchParams } from 'node:url'
import { log } from 'node:console'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const codes = new Map()
const emailReceipts = new Map()
const uncertainSlackWorkspaces = new Set()
const sink = { slack: [], email: [], auth: [], channelPages: [] }
const channel = {
  id: 'C012345',
  name: 'workspace-activity',
  is_member: true,
  is_archived: false,
  is_private: false,
  context_team_id: 'T012345',
}
const brandChannel = { ...channel, id: 'C067890', name: 'brand-publishing' }
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString()
  const form = new URLSearchParams(raw)
  const json = (value) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(value))
  }
  try {
    if (url.pathname === '/sink') return json(sink)
    if (url.pathname === '/fail-next-slack' && request.method === 'POST') {
      const { workspaceName } = JSON.parse(raw)
      assert.equal(typeof workspaceName, 'string')
      assert.ok(workspaceName.length > 0)
      uncertainSlackWorkspaces.add(workspaceName)
      return json({ armed: true })
    }
    if (url.pathname === '/oauth/v2/authorize') {
      assert.equal(url.searchParams.get('state')?.length, 43)
      assert.ok(url.searchParams.get('scope').includes('chat:write'))
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      assert.ok(['localhost', '127.0.0.1'].includes(redirect.hostname))
      const code = randomUUID()
      codes.set(code, redirect.toString())
      redirect.searchParams.set('state', url.searchParams.get('state'))
      redirect.searchParams.set('code', code)
      response.setHeader('content-type', 'text/html')
      return response.end(
        `<h1>Local Slack fixture</h1><p>Workspace: Fixture team</p><a href="${redirect.toString().replaceAll('&', '&amp;')}">Allow selected workspace</a>`
      )
    }
    if (url.pathname === '/api/oauth.v2.access') {
      assert.equal(form.get('redirect_uri'), codes.get(form.get('code')))
      assert.ok(codes.delete(form.get('code')))
      return json({
        ok: true,
        app_id: 'A012345',
        access_token: 'fixture-slack-token',
        scope: 'chat:write,channels:read,groups:read,files:write,channels:join',
        team: { id: 'T012345', name: 'Fixture team' },
        authed_user: { id: 'U012345' },
      })
    }
    if (url.pathname.startsWith('/api/')) {
      assert.equal(request.headers.authorization, 'Bearer fixture-slack-token')
      if (url.pathname === '/api/auth.test')
        return json({ ok: true, team_id: 'T012345', user_id: 'U012345' })
      if (url.pathname === '/api/conversations.list') {
        assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded')
        const cursor = form.get('cursor') ?? url.searchParams.get('cursor') ?? ''
        sink.channelPages.push(cursor)
        return json({
          ok: true,
          channels: cursor ? [channel, brandChannel] : [],
          response_metadata: { next_cursor: cursor ? '' : 'page-two' },
        })
      }
      if (url.pathname === '/api/conversations.info') {
        const selected = [channel, brandChannel].find((item) => item.id === form.get('channel'))
        if (!selected) return json({ ok: false, error: 'invalid_arguments' })
        return json({ ok: true, channel: selected })
      }
      if (url.pathname === '/api/chat.postMessage') {
        const body = request.headers['content-type']?.includes('json')
          ? JSON.parse(raw)
          : Object.fromEntries(form)
        assert.ok([channel.id, brandChannel.id, 'U012345'].includes(body.channel))
        sink.slack.push(body)
        const uncertain = [...uncertainSlackWorkspaces].find((name) =>
          body.text.startsWith(`${name}: `)
        )
        if (uncertain) {
          uncertainSlackWorkspaces.delete(uncertain)
          response.statusCode = 503
          return json({ error: 'fixture_response_lost_after_acceptance' })
        }
        return json({
          ok: true,
          channel: body.channel === 'U012345' ? 'D012345' : channel.id,
          ts: `123.${sink.slack.length}`,
        })
      }
    }
    if (url.pathname === '/emails') {
      assert.equal(request.headers.authorization, 'Bearer fixture-resend-key')
      const key = request.headers['idempotency-key']
      assert.ok(key)
      if (!emailReceipts.has(key)) {
        const receipt = `email-${randomUUID()}`
        emailReceipts.set(key, receipt)
        sink.email.push({ ...JSON.parse(raw), idempotencyKey: key, id: receipt })
      }
      return json({ id: emailReceipts.get(key) })
    }
    if (url.pathname === '/auth-mail') {
      sink.auth.push(JSON.parse(raw))
      return json({ ok: true })
    }
    response.statusCode = 404
    json({ error: 'Unknown fixture endpoint' })
  } catch (error) {
    response.statusCode = 400
    json({ error: String(error) })
  }
})
server.listen(Number(process.env.NOTIFICATIONS_E2E_PROVIDER_PORT ?? 3461), '127.0.0.1', () =>
  log('Notification provider fixture listening')
)
