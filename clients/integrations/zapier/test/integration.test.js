'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createAppTester } = require('zapier-platform-core');
const { validateAppDefinition } = require('zapier-platform-schema');
const { recurseCleanFuncs } = require('zapier-platform-core/src/tools/cleaner');
const app = require('..');
const { receive } = require('../hooks');
const { createDraft, origin, request } = require('../client');

function hook(type = 'draft.published') {
  const authData = {workspaceId:'workspace-1',webhookSecret:'fixture-signing-secret-at-least-32-chars'};
  const envelope = {id:'evt_123',type,schemaVersion:1,workspaceId:'workspace-1',resource:{id:'draft-1',type:'content_draft'},data:{status:'published'}};
  const content = JSON.stringify(envelope);
  const timestamp = String(Math.floor(Date.now()/1000));
  const signature = 'v1=' + createHmac('sha256',authData.webhookSecret).update(`${envelope.id}.${timestamp}.${content}`).digest('hex');
  return {authData,rawRequest:{content,headers:{'X-Shots-Event':type,'X-Shots-Event-Id':envelope.id,'X-Shots-Timestamp':timestamp,'X-Shots-Signature':signature}}};
}

test('the private Zapier app is valid and runs a signed static trigger through its runtime', async () => {
  const validation = validateAppDefinition(recurseCleanFuncs(app));
  assert.deepEqual(validation.errors.map(error => error.stack),[]);
  const tester = createAppTester(app);
  const result = await tester(app.triggers.draft_published.operation.perform,hook());
  assert.equal(result[0].id,'evt_123');
  assert.equal(result[0].draftId,'draft-1');
  assert.equal(Object.keys(app.triggers).filter(key=>key.startsWith('draft_')).length,8);
});

test('signed events retain stable dedup IDs and reject tampering, wrong workspaces, stale signatures and raw-body loss', () => {
  const bundle = hook();
  assert.deepEqual(receive(bundle,'draft.published'),receive(bundle,'draft.published'));
  assert.deepEqual(receive(bundle,'draft.updated'),[]);
  assert.deepEqual(receive(hook('webhook.test'),'draft.published'),[]);
  assert.throws(()=>receive({...bundle,authData:{...bundle.authData,workspaceId:'foreign'}},'draft.published'));
  assert.throws(()=>receive({...bundle,rawRequest:{...bundle.rawRequest,content:bundle.rawRequest.content+' '}},'draft.published'));
  assert.throws(()=>receive(bundle,'draft.published',Date.now()+301000));
  assert.throws(()=>receive({...bundle,rawRequest:{...bundle.rawRequest,content:JSON.parse(bundle.rawRequest.content)}},'draft.published'));
});

test('draft creation uses stable import receipts, available brand accounts and exact API contracts', async () => {
  const calls=[];
  const z={request:async options=>{
    calls.push(options);
    return {status:200,throwForStatus(){},json:options.method==='GET'?{items:[{id:'brand',defaultPlatforms:['x'],accounts:[{id:'connection',platform:'x'}]}]}:{id:'draft',...options.body}};
  }};
  const bundle={authData:{origin:'https://shots.example',apiKey:'fixture'},inputData:{requestId:'google-doc-version-42',socialSetId:'brand',text:'First\n---\nSecond'}};
  const first=await createDraft(z,bundle);
  const again=await createDraft(z,bundle);
  assert.deepEqual(first,again);
  assert.equal(first.body.filter(node=>node.type==='post_break').length,2);
  assert.deepEqual(first.channelConnectionIds,['connection']);
  assert.ok(first.importKey.startsWith('zapier:'));
  assert.ok(calls.every(call=>call.headers['X-API-Key']==='fixture' && call.follow===0));
  await assert.rejects(createDraft(z,{...bundle,inputData:{...bundle.inputData,platforms:['mastodon']}}),/No mastodon/);
  await assert.rejects(createDraft(z,{...bundle,inputData:{...bundle.inputData,requestId:''}}),/stable source/);
});

test('credentials cannot be sent to an insecure origin or a redirect', async () => {
  for(const value of ['http://shots.example','https://user:pass@shots.example','https://shots.example/path','https://shots.example/?key=x']) assert.throws(()=>origin({origin:value}));
  await assert.rejects(request({request:async()=>({status:302})},{authData:{origin:'https://shots.example',apiKey:'fixture'}},'/api/v1/social-sets'),/redirected/);
  assert.equal(app.creates.schedule_draft,undefined);
  assert.equal(app.creates.publish_draft,undefined);
});
