/**
 * WhatsApp real-estate agent — acceptance journey (Staging rules, economic mode, simulated Meta transport).
 * Every outbound call is captured by a fake fetch; nothing leaves the process. These tests prove the logic,
 * not a live Meta connection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ingestWhatsAppEvents, drainWhatsAppQueue, actOnWhatsAppCase, listWhatsAppCases, whatsappAgentStatus } from '../worker/src/office-os/whatsapp-agent-service.js';
import { parseOfferPrice, parseViewingTime, detectAction, readInbound, buttonsMessage, listMessage, WA_LIMITS, viewingConflict } from '../public/os/domain/whatsapp-agent-domain.js';

const CLIENT = '966500000001';
const IMG = (office, rec, n) => ({ id: `${String(n).repeat(32)}`.slice(0, 32), url: `https://cdn.test/${n}.jpg`, path: `record-media/${office}/${rec}/${String(n).repeat(32).slice(0, 32)}.jpg`, contentType: 'image/jpeg' });

function fixture({ envPatch = {} } = {}) {
  const docs = new Map();
  const key = p => p.join('/');
  let failList = null;
  const store = {
    async get(p) { const d = docs.get(key(p)); return d ? structuredClone({ id: p.at(-1), ...d }) : null; },
    async set(p, data) { const k = key(p); docs.set(k, { ...docs.get(k), ...structuredClone(data), __updateTime: String(Number(docs.get(k)?.__updateTime || 0) + 1) }); },
    async create(p, data) { if (docs.has(key(p))) return false; await this.set(p, data); return true; },
    async remove(p) { docs.delete(key(p)); },
    async update(p, mutate) { for (let n = 0; n < 12; n++) { const before = await this.get(p); if (!before) return null; const patch = await mutate(before); if (!patch) return { current: before, patch: null }; if (docs.get(key(p)).__updateTime !== before.__updateTime) continue; await this.set(p, patch); return { current: before, patch, next: { ...before, ...patch } }; } throw Error('conflict'); },
    async queryAfter(parent, collection, { before, field, limit }) { return [...docs].filter(([k, d]) => k.startsWith(key([...parent, collection]) + '/') && new Date(d[field]) < new Date(before)).sort((a, b) => new Date(a[1][field]) - new Date(b[1][field])).slice(0, limit).map(([k, d]) => ({ id: k.split('/').at(-1), ...structuredClone(d) })); },
    async list(p) { if (failList && failList(p)) throw Object.assign(Error('firestore down'), { code: 'firestore_unavailable' }); return [...docs].filter(([k]) => k.startsWith(key(p) + '/') && k.split('/').length === p.length + 1).map(([k, d]) => ({ id: k.split('/').at(-1), ...structuredClone(d) })); }
  };
  let at = new Date('2026-10-17T09:00:00Z');
  const env = {
    DEPLOYMENT_ENV: 'staging', FIREBASE_PROJECT_ID: 'iaqar-ai-staging', WHATSAPP_AGENT_ENABLED: 'enabled', WHATSAPP_AGENT_OFFICE_IDS: 'office-a',
    WHATSAPP_AGENT_ALLOWED_RECIPIENTS: CLIENT, WHATSAPP_AGENT_SEND: 'enabled', META_WHATSAPP_ACCESS_TOKEN: 'test-meta-secret',
    // Keys exist on purpose: economic mode must still make zero paid calls.
    ANTHROPIC_API_KEY: 'present-but-unused', ANTHROPIC_MODEL: 'unused', OPENAI_API_KEY: 'present-but-unused',
    FIREBASE_PRIVATE_KEY: 'local-hmac-fixture', WHATSAPP_MEDIA_ORIGIN: 'https://media.staging.test', ...envPatch
  };
  const calls = [];
  const paired = [];
  const ctx = {
    store, env, now: () => new Date(at), appOrigin: 'https://staging.iaqar.test',
    deps: {
      sha256Hex: async s => createHash('sha256').update(s).digest('hex'), officeIdsEquivalent: (a, b) => a === b,
      appError: (code, status, message) => Object.assign(Error(message), { code, status }),
      persistManualPair: async ({ officeId, recordId, counterpartId }) => { paired.push({ officeId, recordId, counterpartId }); return { matchId: `m_${counterpartId}`, operationId: 'op1' }; }
    },
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ messages: [{ id: `wamid.${calls.length}` }] }); }
  };
  const seed = async () => {
    await store.set(['whatsapp_accounts', 'phone-a'], { officeId: 'office-a', wabaId: 'waba-a', status: 'connected', isOnBizApp: true, platformType: 'CLOUD_API', metaPhoneStatus: 'CONNECTED' });
    await store.set(['offices', 'office-a', 'integrations', 'whatsapp'], { autoReplyEnabled: true });
    await store.set(['offices', 'office-a'], { officeName: 'مكتب الاختبار', city: 'الرياض', ownerUid: 'broker-1' });
    await store.set(['publicOffices', 'office-a'], { active: true, officeName: 'مكتب الاختبار', city: 'الرياض', publicSlug: 'test-office' });
    await store.set(['publicOffices', 'office-b'], { active: true, officeName: 'مكتب آخر', city: 'الرياض' });
    const villa = (id, price, extra = {}) => store.set(['offices', extra.officeId || 'office-a', 'opportunities', id], {
      officeId: extra.officeId || 'office-a', opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'فيلا', city: 'الرياض', district: 'الملقا',
      priceOrBudget: price, salePrice: price, advertiserRole: 'OWNER', contactPhone: '0551234567', contactName: 'مالك سري', notes: 'ملاحظة داخلية سرية',
      lifecycleStatus: 'ACTIVE', publicSearchVisible: true, rooms: 5, area: 400, version: 1, brokerId: 'broker-1', ...extra
    });
    await villa('v1', 1500000, { images: [IMG('office-a', 'v1', 'a'), IMG('office-a', 'other', 'b')], negotiationFloor: 1400000 });
    await villa('v2', 1800000);
    await villa('v3', 1900000);
    await villa('v4', 1950000);
    await villa('over-budget', 2600000);
    await villa('private', 1600000, { publicSearchVisible: false });
    await villa('sold', 1550000, { availabilityStatus: 'SOLD' });
    await villa('b1', 1700000, { officeId: 'office-b' });
  };
  const sayRaw = async (message) => {
    const before = calls.length;
    await ingestWhatsAppEvents(ctx, { object: 'whatsapp_business_account', entry: [{ id: 'waba-a', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'phone-a' }, contacts: [{ wa_id: message.from || CLIENT, profile: { name: 'سلطان' } }], messages: [{ from: CLIENT, timestamp: String(Math.floor(at.getTime() / 1000)), ...message }] } }] }] });
    at = new Date(at.getTime() + 1000);
    await drainWhatsAppQueue(ctx);
    return calls.slice(before).filter(c => c.url.includes('graph.facebook')).map(c => c.body);
  };
  let n = 0;
  const say = (text) => sayRaw({ id: `wamid.in.${++n}`, type: 'text', text: { body: text } });
  const tap = (id, title = 'زر') => sayRaw({ id: `wamid.in.${++n}`, type: 'interactive', interactive: { type: id.includes(':') && /DETAILS|INTEREST/.test(id) ? 'list_reply' : 'button_reply', [id.includes(':') && /DETAILS|INTEREST/.test(id) ? 'list_reply' : 'button_reply']: { id, title } } });
  const cases = async () => store.list(['offices', 'office-a', 'whatsappCases']);
  const bodyOf = m => m.type === 'text' ? m.text.body : m.type === 'interactive' ? m.interactive.body.text : m.image?.caption || '';
  const all = sent => sent.map(bodyOf).join('\n');
  const paid = () => calls.filter(c => /anthropic|openai/.test(c.url)).length;
  // The order the client was shown (ranking is the central engine's, not the test's).
  const shown = async () => ((await store.list(['offices', 'office-a', 'whatsappConversations']))[0]?.results || []);
  return { shown, ctx, docs, calls, paired, seed, say, tap, sayRaw, cases, all, paid, advance: ms => { at = new Date(at.getTime() + ms); }, now: () => at, failListWhen: fn => { failList = fn; } };
}

async function untilResults(f) {
  await f.seed();
  const ask = await f.say('السلام عليكم أبحث عن فيلا للشراء في حي الملقا بالرياض ميزانيتي 2 مليون');
  const results = await f.say('موافق');
  return { ask, results };
}

test('A1 villa request: intent and specs extracted, consent asked before anything is saved', async () => {
  const f = fixture(); await f.seed();
  const sent = await f.say('السلام عليكم أبحث عن فيلا للشراء في حي الملقا بالرياض ميزانيتي 2 مليون');
  const text = f.all(sent);
  assert.match(text, /فيلا/); assert.match(text, /الملقا/); assert.match(text, /2,000,000/); assert.match(text, /موافق/);
  assert.equal((await f.ctx.store.list(['offices', 'office-a', 'opportunities'])).filter(r => r.opportunityKind !== 'OFFER').length, 0);
  assert.equal(f.paid(), 0);
});

test('A2 the inbound message is stored once and linked to the right office, even when Meta resends it', async () => {
  const f = fixture(); await f.seed();
  const msg = { id: 'wamid.same', type: 'text', text: { body: 'أبحث عن فيلا' } };
  const first = await f.sayRaw(msg); const second = await f.sayRaw(msg);
  const inbox = (await f.ctx.store.list(['offices', 'office-a', 'inbox'])).filter(r => r.source === 'whatsapp_cloud_api');
  assert.equal(inbox.length, 1); assert.equal(inbox[0].officeId, 'office-a');
  assert.equal(first.length, 1); assert.equal(second.length, 0, 'a replayed webhook never produces a second reply');
});

test('A3 search returns only real, published, live offers of this office — top 3 first, with exact data', async () => {
  const f = fixture(); const { results } = await untilResults(f);
  const text = f.all(results);
  assert.match(text, /أفضل 3/);
  const shown = await f.shown();
  assert.deepEqual(shown.map(r => r.reference).sort(), ['office-a:v1', 'office-a:v2', 'office-a:v3', 'office-a:v4']);
  for (const r of shown.slice(0, 3)) {
    const db = await f.ctx.store.get(['offices', 'office-a', 'opportunities', r.reference.split(':')[1]]);
    assert.ok(text.includes(r.reference), r.reference);
    assert.ok(text.includes(Number(db.salePrice).toLocaleString('en-US')), `price of ${r.reference} equals the database`);
  }
  assert.ok(!text.includes(shown[3].reference), 'only three are shown first');
  for (const hidden of ['private', 'sold', 'over-budget', 'office-b', 'مالك سري', '0551234567', 'ملاحظة داخلية']) assert.ok(!text.includes(hidden), hidden);
  const list = results.find(m => m.type === 'interactive' && m.interactive.type === 'list');
  assert.ok(list, 'an interactive list follows the results');
  const rows = list.interactive.action.sections.flatMap(s => s.rows);
  assert.ok(rows.length <= WA_LIMITS.LIST_ROWS); assert.ok(rows.every(r => r.title.length <= WA_LIMITS.ROW_TITLE));
  assert.ok(rows.some(r => r.id === 'wa:MORE'), 'alternatives are offered (4 matches, 3 shown)');
  const crm = (await f.ctx.store.list(['offices', 'office-a', 'opportunities'])).filter(r => r.opportunityKind === 'REQUEST' || r.kind === 'REQUEST' || r.intakeOrigin);
  assert.equal(crm.length, 1, 'the client request is saved once in the office CRM');
  assert.equal(f.paid(), 0);
});

test('A4 no match → a clear answer, the request kept, no invented offer', async () => {
  const f = fixture(); await f.seed();
  await f.say('أبحث عن شقة للشراء في حي النرجس بالرياض ميزانيتي 300 ألف');
  const sent = await f.say('موافق');
  const text = f.all(sent);
  assert.match(text, /ما وجدت/); assert.ok(!/office-a:/.test(text)); assert.ok(!/ريال/.test(text.replace(/ميزانيت\S*/g, '')));
});

test('A5 details, alternatives and photos come from the record; photos of another record are never sent', async () => {
  const f = fixture(); await untilResults(f);
  const shown = await f.shown();
  const i = shown.findIndex(r => r.reference === 'office-a:v1');
  const details = await f.tap(`wa:DETAILS:${i}`, 'تفاصيل');
  assert.match(f.all(details), /المرجع: office-a:v1/); assert.match(f.all(details), /1,500,000/); assert.match(f.all(details), /الغرف: 5/);
  assert.match(f.all(details), /https:\/\/staging\.iaqar\.test\/m\/test-office/);
  const photos = await f.tap(`wa:PHOTOS:${i}`, 'مشاهدة الصور');
  const images = photos.filter(m => m.type === 'image');
  assert.equal(images.length, 1);
  assert.ok(images[0].image.link.startsWith('https://media.staging.test/media/public/record-media/office-a/v1/'));
  const more = await f.tap('wa:MORE', 'عرض بدائل');
  assert.ok(f.all(more).includes(shown[3].reference)); for (const r of shown.slice(0, 3)) assert.ok(!f.all(more).includes(r.reference));
});

test('A6 interest reaches the office as a lead + match review; negotiation is recorded, never accepted', async () => {
  const f = fixture(); await untilResults(f);
  const first = (await f.shown())[0].reference;
  const interest = await f.tap('wa:INTEREST:0', 'مهتم بالعرض 1');
  assert.match(f.all(interest), /تم تسجيل اهتمامك/); assert.match(f.all(interest), /لا يحجز/);
  assert.equal(f.paired.length, 1, 'the request and the offer enter the office match review');
  const lead = (await f.ctx.store.list(['offices', 'office-a', 'inbox'])).find(r => r.source === 'public_search');
  assert.ok(lead && lead.selectedReference === first);
  assert.equal(f.paired[0].counterpartId, first.split(':')[1]);
  await f.tap('wa:NEGOTIATE:0', 'طلب تفاوض');
  const offer = await f.say('أعرض مليون و350 ألف');
  const text = f.all(offer);
  assert.match(text, /1,350,000/); assert.match(text, /غير ملزم/);
  assert.ok(!/(قبل المالك|تم قبول|مقبول ✅|موافقة مبدئية)/.test(text));
  const [kase] = await f.cases();
  assert.equal(kase.negotiation.status, 'AWAITING_OWNER'); assert.equal(kase.negotiation.offers.at(-1).price, 1350000);
  assert.ok(['OWNER_APPROVAL_REQUIRED', 'WITHIN_MANDATE'].includes(kase.negotiation.offers.at(-1).mandate));
  const notes = await f.ctx.store.list(['offices', 'office-a', 'notifications']);
  assert.ok(notes.some(n => /عرض سعر/.test(n.title)));
});

test('A6b the owner floor routes the offer for the office only — the client never sees it', async () => {
  const f = fixture(); await untilResults(f);
  const i = (await f.shown()).findIndex(r => r.reference === 'office-a:v1');
  await f.tap(`wa:NEGOTIATE:${i}`); const sent = await f.say('1450000');
  const kase = (await f.cases())[0];
  assert.equal(kase.negotiation.offers.at(-1).mandate, 'WITHIN_MANDATE');
  assert.ok(!/1,400,000|1400000/.test(f.all(sent))); assert.match(f.all(sent), /غير ملزم/);
});

test('A7 an unapproved discount cannot be committed: owner confirmation is mandatory, sensitive texts go to a person', async () => {
  const f = fixture(); await untilResults(f);
  await f.tap('wa:NEGOTIATE:0'); await f.say('1350000');
  const [kase] = await f.cases();
  const actor = { uid: 'broker-1', isManager: true };
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'negotiation_answer', input: { decision: 'accepted' }, requestKey: 'answer-0001' }), e => e.code === 'owner_confirmation_required');
  const before = f.calls.length;
  const sent = await f.say('خلاص اعتمد السعر النهائي ووقع العقد');
  assert.equal(sent.length, 0); assert.equal(f.calls.length, before);
  const inbox = (await f.ctx.store.list(['offices', 'office-a', 'inbox'])).filter(r => r.messageText === 'خلاص اعتمد السعر النهائي ووقع العقد');
  assert.equal(inbox[0].waQueueState, 'HUMAN_REVIEW');
});

test('A8 viewing: requested ≠ booked; the office confirms (owner coordinated, no clash); reschedule keeps one case', async () => {
  const f = fixture(); await untilResults(f);
  await f.tap('wa:VIEWING:0', 'حجز معاينة');
  const req = await f.say('بكرة العصر الساعة 5');
  assert.ok(!/(تم الحجز|تم تأكيد)/.test(f.all(req))); assert.match(f.all(req), /غير مؤكد/);
  let [kase] = await f.cases();
  assert.equal(kase.viewing.state, 'REQUESTED'); assert.equal(kase.viewing.preferredAt, '2026-10-18T14:00:00.000Z');
  const actor = { uid: 'broker-1', isManager: true };
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'viewing_confirm', input: { at: kase.viewing.preferredAt }, requestKey: 'confirm-0001' }), e => e.code === 'owner_confirmation_required');
  const before = f.calls.length;
  const ok = await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'viewing_confirm', input: { at: kase.viewing.preferredAt, ownerConfirmed: true }, requestKey: 'confirm-0002' });
  assert.equal(ok.delivery.state, 'SENT');
  assert.match(JSON.stringify(f.calls.slice(before)), /تم تأكيد موعد المعاينة/);
  const again = await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'viewing_confirm', input: { at: kase.viewing.preferredAt, ownerConfirmed: true }, requestKey: 'confirm-0002' });
  assert.equal(again.duplicate, true); assert.equal(f.calls.length, before + 1, 'a replayed office action sends nothing');
  const moved = await f.say('غير الموعد للخميس 7 م');
  assert.match(f.all(moved), /تغيير موعد/);
  const all = await f.cases(); assert.equal(all.length, 1, 'no duplicate case');
  [kase] = all; assert.equal(kase.viewing.state, 'RESCHEDULE_REQUESTED'); assert.equal(kase.viewing.history.length, 1);
});

test('A9 two confirmed viewings for the same property at the same time are refused', () => {
  const at = '2026-10-18T14:00:00.000Z';
  const clash = viewingConflict([{ id: 'x', reference: 'office-a:v1', viewing: { state: 'CONFIRMED', at } }], { caseId: 'y', reference: 'office-a:v1', at: '2026-10-18T14:30:00.000Z' });
  assert.equal(clash?.id, 'x');
  assert.equal(viewingConflict([{ id: 'x', reference: 'office-a:v1', viewing: { state: 'CONFIRMED', at } }], { caseId: 'y', reference: 'office-a:v2', at }), null);
});

test('A10 reminder before and follow-up after a confirmed viewing, each sent once; the answer updates the case', async () => {
  const f = fixture(); await untilResults(f);
  await f.tap('wa:VIEWING:0'); await f.say('بكرة العصر الساعة 5');
  let [kase] = await f.cases();
  const actor = { uid: 'broker-1', isManager: true };
  const at = new Date(f.now().getTime() + 2 * 3600000).toISOString();
  await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'viewing_confirm', input: { at, ownerConfirmed: true }, requestKey: 'confirm-0003' });
  const before = f.calls.length;
  await drainWhatsAppQueue(f.ctx); await drainWhatsAppQueue(f.ctx);
  assert.equal(f.calls.length - before, 1); assert.match(JSON.stringify(f.calls.at(-1).body), /تذكير/);
  f.advance(4.5 * 3600000);
  // The customer-service window is still open: the client wrote within the last 24 hours.
  await drainWhatsAppQueue(f.ctx); await drainWhatsAppQueue(f.ctx);
  assert.equal(f.calls.length - before, 2); assert.match(JSON.stringify(f.calls.at(-1).body), /كيف كانت معاينة/);
  const answer = await f.tap('wa:FOLLOWUP_GOOD', 'مناسب، أبغى أكمل');
  assert.match(f.all(answer), /بلغت المكتب/);
  [kase] = await f.cases();
  assert.equal(kase.stage, 'VIEWED'); assert.equal(kase.opportunityTemperature, 'HOT'); assert.equal(kase.followUp.result, 'SUITABLE');
});

test('A11 closing: agreement only after the owner accepted; closing needs official confirmations and stops marketing', async () => {
  const f = fixture(); await untilResults(f);
  await f.tap('wa:NEGOTIATE:0'); await f.say('1450000');
  const [kase] = await f.cases(); const actor = { uid: 'broker-1', isManager: true };
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'agreement', requestKey: 'agree-00001' }), e => e.code === 'action_not_allowed');
  await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'negotiation_answer', input: { decision: 'accepted', ownerConfirmed: true, ownerConfirmationSource: 'اتصال هاتفي مع المالك' }, requestKey: 'answer-0002' });
  await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'agreement', requestKey: 'agree-00002' });
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'close_won', input: { confirmations: { ownerApproval: true } }, requestKey: 'close-00001' }), e => e.code === 'closing_confirmations_required');
  const closed = await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'close_won', input: { finalPrice: 1450000, confirmations: { ownerApproval: true, contractSigned: true, paymentHandledOfficially: true } }, requestKey: 'close-00002' });
  assert.equal(closed.case.stage, 'CLOSED_WON'); assert.equal(closed.case.outcome.finalPrice, 1450000);
  assert.equal((await f.ctx.store.get(['offices', 'office-a', 'opportunities', kase.recordId])).availabilityStatus, 'SOLD');
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor, caseId: kase.id, action: 'close_lost', requestKey: 'lost-000001' }), e => e.code === 'action_not_allowed');
  const audits = await f.ctx.store.list(['offices', 'office-a', 'auditLogs']);
  for (const a of ['WHATSAPP_CASE_NEGOTIATION_ANSWER', 'WHATSAPP_CASE_AGREEMENT', 'WHATSAPP_CASE_CLOSE_WON', 'RECORD_AVAILABILITY_CLOSED']) assert.ok(audits.some(x => x.action === a), a);
  // A new search no longer markets the sold villa.
  const g = await f.say('بحث جديد'); assert.match(f.all(g), /طلبًا جديدًا/);
  await f.say('أبحث عن فيلا للشراء في حي الملقا بالرياض ميزانيتي 2 مليون');
  const again = await f.say('موافق');
  assert.ok(!f.all(again).includes(kase.reference)); assert.ok((await f.shown()).every(r => r.reference !== kase.reference));
});

test('A12 database outage → a safe message, nothing invented', async () => {
  const f = fixture(); await f.seed();
  await f.say('أبحث عن فيلا للشراء في حي الملقا بالرياض ميزانيتي 2 مليون');
  f.failListWhen(p => p.join('/') === 'offices/office-a/opportunities');
  const sent = await f.say('موافق');
  assert.match(f.all(sent), /تعذر الوصول لبيانات العروض/); assert.ok(!/office-a:v/.test(f.all(sent)));
});

test('A13 office isolation: another office sees neither the case nor the client, and cannot act on it', async () => {
  const f = fixture(); await untilResults(f); await f.tap('wa:INTEREST:0');
  const [kase] = await f.cases();
  const other = { uid: 'broker-b', isManager: true };
  const listed = await listWhatsAppCases(f.ctx, { officeId: 'office-b', actor: other });
  assert.equal(listed.cases.length, 0);
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-b', actor: other, caseId: kase.id, action: 'close_lost', requestKey: 'xoffice-0001' }), e => e.code === 'case_not_found');
  const sameOfficeOtherBroker = { uid: 'broker-9', isManager: false };
  await assert.rejects(actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor: sameOfficeOtherBroker, caseId: kase.id, action: 'close_lost', requestKey: 'xbroker-0001' }), e => e.status === 403);
  assert.ok(!JSON.stringify(f.calls).includes('b1'), 'office-b inventory never reaches office-a clients');
});

test('A14 economic mode end to end: zero paid AI calls; with sending off every reply is SIMULATED and nothing leaves', async () => {
  const f = fixture({ envPatch: { WHATSAPP_AGENT_SEND: 'disabled' } }); await untilResults(f);
  await f.tap('wa:INTEREST:0'); await f.tap('wa:VIEWING:0'); await f.say('الخميس 7 م');
  assert.equal(f.calls.length, 0, 'no network call at all');
  const states = (await f.ctx.store.list(['offices', 'office-a', 'inbox'])).filter(r => r.source === 'whatsapp_cloud_api').map(r => r.waQueueState);
  assert.ok(states.every(s => s === 'SIMULATED'), states.join(','));
  const status = await whatsappAgentStatus(f.ctx, { officeId: 'office-a', actor: { isManager: true } });
  assert.equal(status.economicMode, true); assert.equal(status.paidClassifier, false);
});

test('A15 only allowlisted test recipients ever receive a message', async () => {
  const f = fixture({ envPatch: { WHATSAPP_AGENT_ALLOWED_RECIPIENTS: '966599999999' } }); await f.seed();
  const sent = await f.say('أبحث عن فيلا');
  assert.equal(sent.length, 0); assert.equal(f.calls.length, 0);
});

test('A16 office updates outside the 24-hour window are not sent: an approved template is required', async () => {
  const f = fixture(); await untilResults(f); await f.tap('wa:VIEWING:0'); await f.say('بكرة العصر الساعة 5');
  const [kase] = await f.cases();
  f.advance(25 * 3600000);
  const before = f.calls.length;
  const r = await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor: { uid: 'broker-1', isManager: true }, caseId: kase.id, action: 'viewing_confirm', input: { at: new Date(f.now().getTime() + 86400000).toISOString(), ownerConfirmed: true }, requestKey: 'late-000001' });
  assert.equal(r.delivery.state, 'TEMPLATE_REQUIRED'); assert.equal(f.calls.length, before);
});

test('A17 «موظف» hands the conversation to a person once; the office can resume the agent', async () => {
  const f = fixture(); await untilResults(f); await f.tap('wa:INTEREST:0');
  const h = await f.say('ابغى اكلم موظف');
  assert.match(f.all(h), /تم تحويل محادثتك لموظف/);
  assert.equal((await f.say('تفاصيل العرض 2')).length, 0, 'silent while a person owns the conversation');
  const [kase] = await f.cases();
  await actOnWhatsAppCase(f.ctx, { officeId: 'office-a', actor: { uid: 'broker-1', isManager: true }, caseId: kase.id, action: 'resume_agent', requestKey: 'resume-00001' });
  const back = await f.say('تفاصيل العرض 2');
  assert.ok(f.all(back).includes((await f.shown())[1].reference));
});

test('domain: prices, times, button ids and Cloud API limits', () => {
  assert.equal(parseOfferPrice('مليون ونص'), 1500000); assert.equal(parseOfferPrice('450 ألف'), 450000); assert.equal(parseOfferPrice('٢٫٥ مليون'), 2500000);
  assert.equal(parseOfferPrice('مليونين و300 ألف'), 2300000); assert.equal(parseOfferPrice('ابغى اعرض'), null);
  const now = new Date('2026-10-17T09:00:00Z');
  assert.equal(parseViewingTime('بكرة العصر الساعة 5', now).at, '2026-10-18T14:00:00.000Z');
  assert.equal(parseViewingTime('أي وقت يناسبكم', now).at, null);
  assert.deepEqual(detectAction({ actionId: 'wa:EVIL:1' }, {}).type, 'NONE');
  assert.deepEqual(readInbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'wa:MORE', title: 'عرض بدائل' } } }), { kind: 'interactive', text: 'عرض بدائل', actionId: 'wa:MORE' });
  const b = buttonsMessage('x', [{ id: 'a', title: 'عنوان طويل جدًا يتجاوز الحد المسموح' }, { id: 'b', title: '2' }, { id: 'c', title: '3' }, { id: 'd', title: '4' }]);
  assert.equal(b.interactive.action.buttons.length, 3); assert.ok(b.interactive.action.buttons[0].reply.title.length <= 20);
  const l = listMessage('x', { sections: [{ title: 's', rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: `row ${i}` })) }] });
  assert.equal(l.interactive.action.sections[0].rows.length, 10);
});

test('A18 alternatives keep the client\'s numbering: a withdrawn offer is skipped, never renumbered', async () => {
  const f = fixture(); await untilResults(f);
  const shown = await f.shown();
  await f.ctx.store.set(['offices', 'office-a', 'opportunities', shown[3].reference.split(':')[1]], { publicSearchVisible: false });
  const more = await f.tap('wa:MORE', 'عرض بدائل');
  assert.match(f.all(more), /ما عندي بدائل إضافية/);
  assert.ok(!f.all(more).includes(shown[3].reference));
  const again = await f.tap('wa:DETAILS:2', 'تفاصيل');
  assert.ok(f.all(again).includes(shown[2].reference), 'button 3 still means the third property');
});
