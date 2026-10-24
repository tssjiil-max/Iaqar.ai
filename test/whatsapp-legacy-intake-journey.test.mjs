/**
 * B-04 — the legacy (non-agent) WhatsApp intake path, end to end through the real Worker:
 * signed Meta webhook → whatsapp_accounts mapping → offices/{office}/inbox → canonical intake
 * → offices/{office}/opportunities → the office's default records list.
 *
 * These tests pin CURRENT behaviour before any change to the WhatsApp path (B-03 and later).
 * The "unlinked number" cases describe today's behaviour on purpose; B-03 changes them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B } from '../scripts/qa/office-os/server.mjs';
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

// KNOWN DEFECT (backlog B-07): extractMessageText() returns the placeholder «[رسالة image]» for caption-less
// media, so the needs_media_adapter branch in saveInboundMessage() is never reached and an empty record
// (no kind) is created. This test pins today's behaviour; B-07 flips it to the intended one.
test('CURRENT (pre-B-07): caption-less media becomes an empty record instead of waiting for review', async () => {
  const records = whatsappRecords(OFFICE_A).length;
  const image = { id: 'b04-image', from: '966500000009', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } };
  const r = await deliver(event({ phone: 'b04-phone-a', waba: 'b04-waba-a', messages: [image] }));
  assert.equal(r.body.received, 1);
  const [saved] = inboxFor(OFFICE_A, 'b04-image');
  assert.equal(saved.messageText, '[رسالة image]');
  assert.notEqual(saved.processingState, 'needs_media_adapter');
  assert.ok(saved.opportunityId);
  assert.equal(whatsappRecords(OFFICE_A).length, records + 1);
  assert.equal(kindOf(h.store.get(`offices/${OFFICE_A}/opportunities/${saved.opportunityId}`)), '');
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

// ── Current behaviour, documented before B-03 changes it ──────────────────────────────────────────
test('CURRENT (pre-B-03): an unlinked number is acknowledged with 200 and the message is stored nowhere', async () => {
  const before = allInboxMessageIds().length;
  const r = await deliver(event({ phone: 'b04-phone-unknown', waba: 'b04-waba-x', messages: [textMessage('b04-unlinked', REQUEST_TEXT)] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.received, 0);
  assert.equal(r.body.unlinked, 1);
  assert.equal(allInboxMessageIds().length, before);
  assert.ok(!allInboxMessageIds().includes('b04-unlinked'));
});

test('CURRENT (pre-B-03): a mapping that is not "connected" is treated exactly like an unlinked number', async () => {
  const before = inbox(OFFICE_A).length;
  const r = await deliver(event({ phone: 'b04-phone-off', waba: 'b04-waba-a', messages: [textMessage('b04-disconnected', OFFER_TEXT)] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.unlinked, 1);
  assert.equal(inbox(OFFICE_A).length, before);
});
