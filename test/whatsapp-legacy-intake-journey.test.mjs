/**
 * B-04 — the legacy (non-agent) WhatsApp intake path, end to end through the real Worker:
 * signed Meta webhook → whatsapp_accounts mapping → offices/{office}/inbox → canonical intake
 * → offices/{office}/opportunities → the office's default records list.
 *
 * Written for B-04 to pin the path before changing it (D-019). The cases that B-03 and B-07 changed now
 * assert the intended behaviour (D-022): an unrouted number leaves a privacy-minimal diagnostic instead of
 * vanishing, and caption-less media waits for review with its media reference instead of becoming a record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B, idTokenFor } from '../scripts/qa/office-os/server.mjs';
import { filterRecords, kindOf, RECORD_KIND } from '../public/os/domain/records-domain.js';

const SECRET = 'b04-hmac-secret';
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
// The legacy path only: the WhatsApp agent stays off for every office in this file.
Object.assign(h.env, { META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: 'b04-verify', WHATSAPP_AGENT_ENABLED: '', WHATSAPP_AGENT_OFFICE_IDS: '' });

h.store.seed('whatsapp_accounts/b04-phone-a', { officeId: OFFICE_A, wabaId: 'b04-waba-a', phoneNumberId: 'b04-phone-a', status: 'connected' });
h.store.seed('whatsapp_accounts/b04-phone-b', { officeId: OFFICE_B, wabaId: 'b04-waba-b', phoneNumberId: 'b04-phone-b', status: 'connected' });
h.store.seed('whatsapp_accounts/b04-phone-off', { officeId: OFFICE_A, wabaId: 'b04-waba-a', phoneNumberId: 'b04-phone-off', status: 'disconnected' });

const OFFER_TEXT = 'للبيع شقة في حي العزيزية بالمدينة المنورة 3 غرف السعر 650 ألف للتواصل 0500000009';
const REQUEST_TEXT = 'مطلوب شقة للإيجار في حي قباء بالمدينة المنورة غرفتين الميزانية 40 ألف سنويا جوالي 0500000008';

const textMessage = (id, body, from = '966500000009') => ({ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } });
const event = ({ phone, waba, messages = [], statuses, field = 'messages', object = 'whatsapp_business_account' }) => ({
  object,
  entry: [{ id: waba, changes: [{ field, value: {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: phone, display_phone_number: '966500000000' },
    contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: 'سالم أحمد' } })),
    messages,
    ...(statuses ? { statuses } : {})
  } }] }]
});
async function deliver(payload, { secret = SECRET } = {}) {
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const response = await h.worker.fetch(new Request('https://worker.test/meta/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body
  }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const inbox = (officeId) => h.store.list(`offices/${officeId}/inbox`);
const inboxFor = (officeId, messageId) => inbox(officeId).filter((d) => d.messageId === messageId);
const whatsappRecords = (officeId) => h.store.list(`offices/${officeId}/opportunities`).filter((o) => o.sourceChannel === 'whatsapp');
const allInboxMessageIds = () => [OFFICE_A, OFFICE_B].flatMap((o) => inbox(o).map((d) => d.messageId));

test('linked number: an owner offer is saved to the mapped office inbox and becomes a visible OFFER record', async () => {
  const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-offer-1', OFFER_TEXT)] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.received, 1);
  assert.equal(r.body.unlinked, 0);

  const [saved] = inboxFor(OFFICE_A, 'b04-offer-1');
  assert.ok(saved, 'inbox document exists');
  assert.equal(saved.officeId, OFFICE_A);
  assert.equal(saved.phoneNumberId, 'b04-phone-a');
  assert.equal(saved.direction, 'inbound');
  assert.equal(saved.source, 'whatsapp_cloud_api');
  assert.equal(saved.outboundEnabled, false);
  assert.equal(saved.processingState, 'processed');
  assert.equal(saved.messageClass, 'OFFER');
  assert.ok(saved.opportunityId, 'inbox points at the record it produced');

  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${saved.opportunityId}`);
  assert.ok(record, 'opportunity exists');
  assert.equal(record.officeId, OFFICE_A);
  assert.equal(record.currentOwningOfficeId, OFFICE_A);
  assert.equal(record.sourceChannel, 'whatsapp');
  assert.equal(kindOf(record), RECORD_KIND.OFFER);
  assert.equal(record.district, 'العزيزية');
  assert.ok(filterRecords([{ ...record, id: saved.opportunityId }]).length === 1, 'shown in the office default records list');
});

test('linked number: a client request becomes a visible REQUEST record', async () => {
  const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-request-1', REQUEST_TEXT, '966500000008')] }));
  assert.equal(r.status, 200);
  const [saved] = inboxFor(OFFICE_A, 'b04-request-1');
  assert.equal(saved.processingState, 'processed');
  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${saved.opportunityId}`);
  assert.equal(kindOf(record), RECORD_KIND.REQUEST);
  assert.equal(filterRecords([record]).length, 1);
});

test('isolation: a message to office A\'s number never reaches office B, and B\'s number reaches only B', async () => {
  const beforeB = { inbox: inbox(OFFICE_B).length, records: whatsappRecords(OFFICE_B).length };
  await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-iso-a', OFFER_TEXT.replace('650', '700'))] }));
  assert.equal(inbox(OFFICE_B).length, beforeB.inbox);
  assert.equal(whatsappRecords(OFFICE_B).length, beforeB.records);
  assert.equal(inboxFor(OFFICE_A, 'b04-iso-a').length, 1);

  const beforeA = { inbox: inbox(OFFICE_A).length, records: whatsappRecords(OFFICE_A).length };
  await deliver(event({ phone: 'b04-phone-b', waba: 'b04-waba-b', messages: [textMessage('b04-iso-b', OFFER_TEXT.replace('650', '720'))] }));
  assert.equal(inbox(OFFICE_A).length, beforeA.inbox);
  assert.equal(whatsappRecords(OFFICE_A).length, beforeA.records);
  const [savedB] = inboxFor(OFFICE_B, 'b04-iso-b');
  assert.equal(savedB.officeId, OFFICE_B);
  assert.equal(h.store.get(`offices/${OFFICE_B}/opportunities/${savedB.opportunityId}`).officeId, OFFICE_B);
});

test('duplicates: Meta re-delivering the same message id creates no second inbox entry or record', async () => {
  const payload = event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-dup-1', OFFER_TEXT.replace('650', '810'))] });
  const first = await deliver(payload);
  const recordsAfterFirst = whatsappRecords(OFFICE_A).length;
  const second = await deliver(payload);
  assert.equal(first.body.received, 1);
  assert.equal(second.status, 200, 'the retry is still acknowledged so Meta stops retrying');
  assert.equal(second.body.received, 0, 'the retry is not counted as a new message');
  assert.equal(inboxFor(OFFICE_A, 'b04-dup-1').length, 1);
  assert.equal(whatsappRecords(OFFICE_A).length, recordsAfterFirst);
});

test('batch: two messages in one event are both saved', async () => {
  const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [
    textMessage('b04-batch-1', OFFER_TEXT.replace('650', '900')),
    textMessage('b04-batch-2', REQUEST_TEXT.replace('40', '55'), '966500000007')
  ] }));
  assert.equal(r.body.received, 2);
  assert.equal(inboxFor(OFFICE_A, 'b04-batch-1').length, 1);
  assert.equal(inboxFor(OFFICE_A, 'b04-batch-2').length, 1);
});

test('non-property text: a greeting is kept in the inbox for the broker and creates no record', async () => {
  const records = whatsappRecords(OFFICE_A).length;
  await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-greeting', 'السلام عليكم')] }));
  const [saved] = inboxFor(OFFICE_A, 'b04-greeting');
  assert.ok(saved);
  assert.equal(saved.processingState, 'kept');
  assert.ok(!saved.opportunityId);
  assert.equal(whatsappRecords(OFFICE_A).length, records);
});

// ── B-07: media without text ──────────────────────────────────────────────────────────────────────
const mediaMessage = (id, type, payload) => ({ id, from: '966500000009', timestamp: String(Math.floor(Date.now() / 1000)), type, [type]: payload });

for (const [type, payload, extra] of [
  ['image', { id: 'meta-media-img', mime_type: 'image/jpeg', sha256: 'abc123' }, {}],
  ['audio', { id: 'meta-media-voice', mime_type: 'audio/ogg; codecs=opus', voice: true }, { mediaIsVoice: true }],
  ['video', { id: 'meta-media-vid', mime_type: 'video/mp4' }, {}],
  ['document', { id: 'meta-media-doc', mime_type: 'application/pdf', filename: 'صك.pdf' }, { mediaFileName: 'صك.pdf' }],
  ['sticker', { id: 'meta-media-stk', mime_type: 'image/webp' }, {}]
]) {
  test(`caption-less ${type} waits for review with its media reference and creates no record`, async () => {
    const records = whatsappRecords(OFFICE_A).length;
    const id = `b07-${type}`;
    const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [mediaMessage(id, type, payload)] }));
    assert.equal(r.body.received, 1);
    const [saved] = inboxFor(OFFICE_A, id);
    assert.equal(saved.processingState, 'needs_media_adapter');
    assert.equal(saved.processingError, 'channel_media_requires_adapter');
    assert.equal(saved.messageText, undefined, 'no placeholder text that could be converted into a record');
    assert.ok(!saved.opportunityId);
    assert.equal(saved.mediaType, type);
    assert.equal(saved.mediaId, payload.id);
    assert.equal(saved.mediaMimeType, payload.mime_type);
    for (const [k, v] of Object.entries(extra)) assert.equal(saved[k], v);
    assert.equal(whatsappRecords(OFFICE_A).length, records);
  });
}

test('the broker cannot turn a caption-less media message into a record by mistake', async () => {
  const [saved] = inboxFor(OFFICE_A, 'b07-image');
  const response = await h.worker.fetch(new Request('https://worker.test/os/inbox/convert', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idTokenFor('uid-owner-a')}` },
    body: JSON.stringify({ officeId: OFFICE_A, inboxId: saved.id })
  }), h.env, { waitUntil() {} });
  assert.equal(response.status, 409);
});

test('media WITH a caption is still processed from its caption, and keeps its media reference', async () => {
  const msg = mediaMessage('b07-captioned', 'image', { id: 'meta-media-cap', mime_type: 'image/jpeg', caption: OFFER_TEXT.replace('650', '660') });
  await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [msg] }));
  const [saved] = inboxFor(OFFICE_A, 'b07-captioned');
  assert.equal(saved.processingState, 'processed');
  assert.ok(saved.opportunityId);
  assert.equal(saved.mediaId, 'meta-media-cap');
});

test('a non-media message without text (a reaction) is kept for review, not turned into a record', async () => {
  const records = whatsappRecords(OFFICE_A).length;
  const reaction = { id: 'b07-reaction', from: '966500000009', timestamp: String(Math.floor(Date.now() / 1000)), type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } };
  await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [reaction] }));
  const [saved] = inboxFor(OFFICE_A, 'b07-reaction');
  assert.equal(saved.processingState, 'pending_review');
  assert.equal(saved.processingError, 'channel_non_text_message');
  assert.ok(!saved.opportunityId);
  assert.equal(whatsappRecords(OFFICE_A).length, records);
});

test('a location is still read as text (unchanged)', async () => {
  const loc = { id: 'b07-location', from: '966500000009', timestamp: String(Math.floor(Date.now() / 1000)), type: 'location', location: { latitude: 24.47, longitude: 39.61 } };
  await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [loc] }));
  const [saved] = inboxFor(OFFICE_A, 'b07-location');
  assert.match(saved.messageText, /^موقع: 24\.47, 39\.61$/);
});

test('delivery-status-only events create no inbox entry', async () => {
  const before = inbox(OFFICE_A).length;
  const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1' }] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.received, 0);
  assert.equal(inbox(OFFICE_A).length, before);
});

test('rejected before any work: a bad signature returns 401 and saves nothing', async () => {
  const before = allInboxMessageIds().length;
  const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-forged', OFFER_TEXT)] }), { secret: 'not-the-app-secret' });
  assert.equal(r.status, 401);
  assert.equal(allInboxMessageIds().length, before);
  assert.ok(!allInboxMessageIds().includes('b04-forged'));
});

test('ignored: a signed event for another Meta object is acknowledged and saves nothing', async () => {
  const before = allInboxMessageIds().length;
  const r = await deliver(event({ object: 'page', phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [textMessage('b04-page', OFFER_TEXT)] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ignored, true);
  assert.equal(allInboxMessageIds().length, before);
});

// ── B-03: numbers that are not routed to an office ────────────────────────────────────────────────
const events = () => h.store.list('channelRoutingEvents');
const issues = () => h.store.list('channelRoutingIssues');
const issueFor = (phone) => issues().find((i) => i.phoneNumberId === phone);
const SENDER = '966511112222';
const SENDER_NAME = 'عميل لم يُربط رقمه';
const unroutedEvent = (phone, waba, id, text) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: waba, changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: phone, display_phone_number: '966500000000' },
    contacts: [{ wa_id: SENDER, profile: { name: SENDER_NAME } }],
    messages: [{ id, from: SENDER, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }]
  } }] }]
});

test('unrouted number: still 200 for Meta, no office data, and a privacy-minimal diagnostic event', async () => {
  const before = allInboxMessageIds().length;
  const recordsBefore = [OFFICE_A, OFFICE_B].map((o) => whatsappRecords(o).length);
  const text = 'أبحث عن شقة للإيجار في قباء سري-جدًا-123';
  const r = await deliver(unroutedEvent('b03-phone-unknown', 'b03-waba-x', 'wamid.b03-unrouted-1', text));
  assert.equal(r.status, 200, 'acknowledged: a retry cannot fix a missing mapping');
  assert.equal(r.body.received, 0);
  assert.equal(r.body.unlinked, 1);
  assert.equal(r.body.diagnosed, 1);
  assert.equal(allInboxMessageIds().length, before, 'nothing written to any office');
  assert.deepEqual([OFFICE_A, OFFICE_B].map((o) => whatsappRecords(o).length), recordsBefore);

  const recorded = events().filter((e) => e.phoneNumberId === 'b03-phone-unknown');
  assert.equal(recorded.length, 1);
  const [ev] = recorded;
  assert.equal(ev.channel, 'whatsapp');
  assert.equal(ev.reason, 'unmapped');
  assert.equal(ev.messageType, 'text');
  assert.ok(ev.recordedAt && ev.expiresAt);
  assert.ok(Date.parse(ev.expiresAt) > Date.parse(ev.recordedAt));
  const stored = JSON.stringify(ev);
  for (const forbidden of [text, 'سري-جدًا-123', SENDER, SENDER_NAME, 'wamid.b03-unrouted-1']) {
    assert.ok(!stored.includes(forbidden), `diagnostic must not contain ${forbidden}`);
  }
});

test('unrouted number: one open issue per receiving number counts events and stays content-free', async () => {
  await deliver(unroutedEvent('b03-phone-issue', 'b03-waba-y', 'wamid.b03-issue-1', 'رسالة أولى'));
  await deliver(unroutedEvent('b03-phone-issue', 'b03-waba-y', 'wamid.b03-issue-2', 'رسالة ثانية'));
  const issue = issueFor('b03-phone-issue');
  assert.ok(issue, 'issue indicator exists');
  assert.equal(issue.channel, 'whatsapp');
  assert.equal(issue.reason, 'unmapped');
  assert.equal(issue.wabaId, 'b03-waba-y');
  assert.equal(issue.status, 'open');
  assert.equal(Number(issue.eventCount), 2);
  assert.ok(issue.firstSeenAt && issue.lastSeenAt && issue.expiresAt);
  const stored = JSON.stringify(issue);
  for (const forbidden of ['رسالة أولى', 'رسالة ثانية', SENDER, SENDER_NAME]) assert.ok(!stored.includes(forbidden));
});

test('unrouted number: Meta re-delivering the same message is recorded once', async () => {
  const payload = unroutedEvent('b03-phone-retry', 'b03-waba-z', 'wamid.b03-retry-1', 'نص');
  await deliver(payload);
  await deliver(payload);
  assert.equal(events().filter((e) => e.phoneNumberId === 'b03-phone-retry').length, 1);
  assert.equal(Number(issueFor('b03-phone-retry').eventCount), 1);
});

test('a mapping that is not "connected" is diagnosed with its own reason and the mapped office, still writing nothing to that office', async () => {
  const before = inbox(OFFICE_A).length;
  const r = await deliver(event({ phone: 'b04-phone-off', waba: 'b04-waba-a', messages: [textMessage('b03-disconnected', OFFER_TEXT)] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.unlinked, 1);
  assert.equal(inbox(OFFICE_A).length, before);
  const issue = issueFor('b04-phone-off');
  assert.equal(issue.reason, 'mapping_not_connected');
  assert.equal(issue.mappedOfficeId, OFFICE_A);
});

test('delivery-status-only events for an unrouted number create no diagnostic', async () => {
  const before = events().length;
  await deliver(event({ phone: 'b03-phone-status', waba: 'b03-waba-s', statuses: [{ id: 'wamid.s', status: 'read', timestamp: '1' }] }));
  assert.equal(events().length, before);
  assert.equal(issueFor('b03-phone-status'), undefined);
});

test('retention is configurable and bounded', async () => {
  h.env.CHANNEL_DIAGNOSTIC_RETENTION_DAYS = '3';
  try {
    await deliver(unroutedEvent('b03-phone-ttl', 'b03-waba-t', 'wamid.b03-ttl-1', 'نص'));
    const [ev] = events().filter((e) => e.phoneNumberId === 'b03-phone-ttl');
    const days = (Date.parse(ev.expiresAt) - Date.parse(ev.recordedAt)) / 86400000;
    assert.ok(Math.abs(days - 3) < 0.01, `${days} days`);
  } finally { delete h.env.CHANNEL_DIAGNOSTIC_RETENTION_DAYS; }
});

test('platform admin reads the open routing issues; an office owner cannot', async () => {
  const list = (uid, claims) => h.worker.fetch(new Request('https://worker.test/admin/channel-routing-issues', {
    headers: { authorization: `Bearer ${idTokenFor(uid, claims)}` }
  }), h.env, { waitUntil() {} });
  const admin = await list('uid-b03-admin', { platformAdmin: true });
  assert.equal(admin.status, 200);
  const body = await admin.json();
  assert.ok(body.issues.some((i) => i.phoneNumberId === 'b03-phone-issue' && i.eventCount === 2));
  assert.ok(!JSON.stringify(body).includes(SENDER));
  assert.equal((await list('uid-owner-a')).status, 403);
});

