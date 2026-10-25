import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ShotsClient } from '../src/lib/client'
import { contentDraftCreateSchema, contentDraftListQuerySchema } from '../../../lib/api/contracts/content-drafts'
import { draftPlanInputSchema } from '../../../lib/api/contracts/write'

const sample = {id: 'contentdraft1234', title: 'Evidence', plainText: 'Body', version: 1, status: 'draft', socialSetId: 'socialset1234', plannedFor: null}
const calls: {path: string; init?: RequestInit}[] = []
const transport: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  calls.push({path: String(input), init})
  const result = path.endsWith('/social-sets') ? {items: [{id:'socialset1234',name:'Team',visibility:'WORKSPACE',defaultPlatforms:['x'],accounts:[{id:'channel1234',platform:'x',health:'connected'}]}]}
    : init?.method === 'DELETE' ? null
    : path.endsWith('/duplicate') ? {draft: sample,dropped:[]}
    : !init?.method || init.method === 'GET' ? {items: [sample],pinned:[sample]}
    : sample
  return result === null ? new Response(null, {status:204}) : Response.json(result)
}

test('external client writes conform to the actual Shots contracts and preserve import identity', async () => {
  calls.length=0
  const api = new ShotsClient('https://shots.example', 'scoped-key', transport)
  const input = {requestId:'stable-request-id-123',socialSetId:'socialset1234',text:'First\n---\nSecond',title:''}
  await api.create(input)
  const first = calls.at(-1)!
  await api.create(input)
  assert.equal(first.init?.body, calls.at(-1)!.init?.body)
  const body = contentDraftCreateSchema.parse(JSON.parse(String(first.init?.body)))
  assert.equal(body.importKey,input.requestId)
  assert.deepEqual((body.body as {type:string;id?:string}[]).filter((n)=>n.type==='post_break').map(n=>n.id),['import_0','import_1'])
  assert.equal(body.title,'First')
  assert.equal(first.init?.redirect,'error')
  assert.equal((first.init?.headers as Record<string,string>)['x-api-key'],'scoped-key')
  await api.plan(sample.id,'2030-01-01T12:00:00Z','UTC')
  assert.deepEqual(draftPlanInputSchema.parse(JSON.parse(String(calls.at(-1)!.init?.body))), {plannedFor:'2030-01-01T12:00:00Z',timeZone:'UTC'})
  assert.deepEqual(await api.duplicate(sample.id),sample)
  await api.delete(sample.id)
})

test('scheduled filtering uses the server status and includes pinned drafts exactly once', async () => {
  const api = new ShotsClient('https://shots.example','key',transport)
  assert.equal((await api.list({view:'scheduled',search:'evidence'})).length,1)
  const query = contentDraftListQuerySchema.parse(Object.fromEntries(new URL(calls.at(-1)!.path).searchParams))
  assert.equal(query.view,'drafts')
  assert.equal(query.status,'scheduled')
  assert.equal(query.search,'evidence')
})

test('credential boundaries and authorization failures remain visible', async () => {
  for (const origin of ['http://external.example','https://user:pass@shots.example','https://shots.example/a','https://shots.example?key=x']) assert.throws(()=>new ShotsClient(origin,'key'))
  const api=new ShotsClient('http://127.0.0.1:3000','key',async()=>Response.json({error:'forbidden',message:'Missing draft:write scope'}, {status:403}))
  await assert.rejects(api.plan('draft','2030-01-01T12:00:00Z','UTC'),/Missing draft:write scope/)
  await assert.rejects(api.request('https://external.example/api/v1/foo'),/Invalid API path/)
  const limited=new ShotsClient('https://shots.example','key',async()=>Response.json({error:'rate_limited'}, {status:429}))
  await assert.rejects(limited.sets(),/rate_limited/)
})
