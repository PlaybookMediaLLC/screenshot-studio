'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

/** Verify exact received bytes. Zapier deduplicates the returned stable event ID. */
function receive(bundle, eventType, now = Date.now()) {
  const raw = bundle.rawRequest;
  if (!raw || typeof raw.content !== 'string' || Buffer.byteLength(raw.content) > 1024 * 1024) throw new Error('Missing or oversized raw webhook body.');
  const headers = Object.fromEntries(Object.entries(raw.headers || {}).map(([key,value]) => [key.toLowerCase(),String(value)]));
  const id = headers['x-shots-event-id'];
  const timestamp = headers['x-shots-timestamp'];
  const secret = bundle.authData.webhookSecret;
  if (!id || !/^\d{1,12}$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300 || !secret || secret.length < 32) throw new Error('Webhook authentication failed.');
  const expected = Buffer.from('v1=' + createHmac('sha256',secret).update(`${id}.${timestamp}.${raw.content}`).digest('hex'));
  const verified = (headers['x-shots-signature'] || '').split(',').some(value => {
    const received = Buffer.from(value.trim());
    return received.length === expected.length && timingSafeEqual(received,expected);
  });
  if (!verified) throw new Error('Webhook authentication failed.');
  const envelope = JSON.parse(raw.content);
  if (envelope.schemaVersion !== 1 || envelope.id !== id || envelope.workspaceId !== bundle.authData.workspaceId || !envelope.resource?.id || !envelope.data || typeof envelope.data !== 'object') throw new Error('Webhook envelope does not match this connection.');
  if (headers['x-shots-event'] !== envelope.type) throw new Error('Webhook event header does not match its body.');
  if (envelope.type === 'webhook.test') return [];
  if (envelope.type !== eventType) return [];
  return [{ ...envelope, draftId: envelope.resource.id }];
}

const eventLabels = {
  'draft.created': 'Draft Created', 'draft.updated': 'Draft Updated',
  'draft.published': 'Draft Published', 'draft.scheduled': 'Draft Scheduled',
  'draft.planned': 'Draft Planned', 'draft.status_changed': 'Draft Status Changed',
  'draft.tags_changed': 'Draft Tags Changed', 'draft.deleted': 'Draft Deleted',
};

function triggers() {
  return Object.fromEntries(Object.entries(eventLabels).map(([event,label]) => {
    const key = event.replaceAll('.','_');
    return [key, {key,noun:'Draft event',display:{label,description:`Triggers instantly when ${event} is delivered by Shots.`,directions:`Copy this Zap's webhook URL. In Shots, an owner or admin adds it in Settings → Webhooks and selects ${event}. Add the returned signing secret and workspace ID to this Zapier connection. Remove the subscription in Shots when disabling the Zap.`},operation:{type:'hook',perform:(_z,bundle) => receive(bundle,event),sample:{id:'evt_example',type:event,schemaVersion:1,workspaceId:'workspace-example',socialSetId:'brand-example',occurredAt:'2026-10-24T12:00:00Z',resource:{type:'content_draft',id:'draft-example'},data:{title:'Example draft'},draftId:'draft-example'}}}];
  }));
}

module.exports = { receive, triggers };
