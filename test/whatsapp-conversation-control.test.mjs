import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ingestWhatsAppEvents, drainWhatsAppQueue, listWhatsAppConversations, getWhatsAppConversation,
  controlWhatsAppConversation, replyInWhatsAppConversation
} from '../worker/src/office-os/whatsapp-agent-service.js';
import { CONTROL_MODE, EMPLOYEE, controlMode, employeeOf, mayRelease, mayTake, mayView, timeline, HELD_BY_APP } from '../public/os/domain/conversation-control-domain.js';

// Versioned, create-only store with optimistic updates (same double as the pipeline tests). No external transports.
function fixture() {
  const docs = new Map();
  const key = p => p.join('/');
  const store = {
    async get(p) { const d = docs.get(key(p)); return d ? structuredClone({ id: p.at(-1), ...d }) : null; },
    async set(p, data) { const k = key(p); docs.set(k, { ...docs.get(k), ...structuredClone(data), __updateTime: String(Number(docs.get(k)?.__updateTime || 0) + 1) }); },
    async create(p, data) { if (docs.has(key(p))) return false; await this.set(p, data); return true; },
    async remove(p) { docs.delete(key(p)); },
    async update(p, mutate) { for (let n = 0; n < 12; n++) { const before = await this.get(p); if (!before) return null; const patch = await mutate(before); if (!patch) return { current: before, patch: null }; if (docs.get(key(p)).__updateTime !== before.__updateTime) continue; await this.set(p, patch); return { current: before, patch, next: { ...before, ...patch } }; } throw Error('conflict'); },
    async queryAfter(parent, collection, { before, field, limit }) { return [...docs].filter(([k, d]) => k.startsWith(key([...parent, collection]) + '/') && new Date(d[field]) < new Date(before)).sort((a, b) => new Date(a[1][field]) - new Date(b[1][field])).slice(0, limit).map(([k, d]) => ({ id: k.split('/').at(-1), ...structuredClone(d) })); },
    async list(p) { return [...docs].filter(([k]) => k.startsWith(key(p) + '/') && k.split('/').length === p.length + 1).map(([k, d]) => ({ id: k.split('/').at(-1), ...structuredClone(d) })); }
  };
  let at = new Date('2026-10-16T20:00:00Z');
  const env = { DEPLOYMENT_ENV: 'staging', FIREBASE_PROJECT_ID: 'iaqar-ai-staging', WHATSAPP_AGENT_ENABLED: 'enabled', WHATSAPP_AGENT_OFFICE_IDS: 'office-a', WHATSAPP_AGENT_ALLOWED_RECIPIENTS: '966500000001,966500000002', ECONOMIC_TEST_MODE: 'disabled', WHATSAPP_AGENT_SEND: 'enabled', META_WHATSAPP_ACCESS_TOKEN: 'test-meta-secret' };
  const calls = [];
  const ctx = { store, env, now: () => new Date(at), deps: { sha256Hex: async s => createHash('sha256').update(s).digest('hex'), officeIdsEquivalent: (a, b) => a === b, appError: (code, status, message) => Object.assign(Error(message), { code, status }) },
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ messages: [{ id: 'sent-' + calls.length }] }); } };
  store.set(['whatsapp_accounts', 'phone-a'], { officeId: 'office-a', wabaId: 'waba-a', status: 'connected', isOnBizApp: true, platformType: 'CLOUD_API', metaPhoneStatus: 'CONNECTED' });
  store.set(['offices', 'office-a', 'integrations', 'whatsapp'], { autoReplyEnabled: true });
  store.set(['offices', 'office-a'], { officeName: 'مكتب تجريبي' });
  const sends = () => calls.filter(c => c.url.includes('graph.facebook'));
  const conversationId = async (from = '966500000001') => createHash('sha256').update(`phone-a|${from}`).digest('hex').slice(0, 40);
  const conversation = async (from) => store.get(['offices', 'office-a', 'whatsappConversations', await conversationId(from)]);
  const audits = async () => (await store.list(['offices', 'office-a', 'auditLogs'])).map(a => a.action);
  return { ctx, calls, sends, conversationId, conversation, audits, advance: ms => { at = new Date(+at + ms); } };
}
const message = (id, text, from = '966500000001') => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-a', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'phone-a' }, contacts: [{ wa_id: from, profile: { name: 'عميل ' + from.slice(-1) } }], messages: [{ id, from, timestamp: '1792180800', type: 'text', text: { body: text } }] } }] }] });
const echo = (id, text, to = '966500000001') => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-a', changes: [{ field: 'smb_message_echoes', value: { metadata: { phone_number_id: 'phone-a' }, message_echoes: [{ id, from: '966511111111', to, timestamp: '1792180800', type: 'text', text: { body: text } }] } }] }] });
const BROKER = { uid: 'broker-1', isManager: false }, OTHER = { uid: 'broker-2', isManager: false }, MANAGER = { uid: 'owner', isManager: true };
async function turn(f, id, text, from) { await ingestWhatsAppEvents(f.ctx, message(id, text, from)); f.advance(1); await drainWhatsAppQueue(f.ctx); }
const take = async (f, actor, key = 'take-key-' + actor.uid, from) => { const c = await f.conversation(from); return controlWhatsAppConversation(f.ctx, { officeId: 'office-a', actor, conversationId: c.id, action: 'take', expectedVersion: Number(c.controlVersion || 0), requestKey: key }); };

test('domain: mode, employee, who may view / take / hand back', () => {
  assert.equal(controlMode({}), CONTROL_MODE.AI);
  assert.equal(controlMode({ handoff: true }), CONTROL_MODE.WAITING);
  assert.equal(controlMode({ handoff: true, heldBy: 'b' }), CONTROL_MODE.HUMAN);
  assert.equal(controlMode({ handoff: true, optedOut: true }), CONTROL_MODE.OPTED_OUT);
  assert.equal(employeeOf({ awaiting: 'offer_price' }), EMPLOYEE.NEGOTIATION);
  assert.equal(employeeOf({ awaiting: 'viewing_time' }), EMPLOYEE.FOLLOW_UP);
  assert.equal(employeeOf({ stage: 'RESULTS' }), EMPLOYEE.SEARCH);
  assert.equal(mayView({ heldBy: 'b2' }, { uid: 'b1' }), false);
  assert.equal(mayView({}, { uid: 'b1' }, ['b2']), false, 'a case assigned to another broker hides the thread');
  assert.equal(mayView({ heldBy: HELD_BY_APP }, { uid: 'b1' }, ['', 'b1']), true);
  assert.equal(mayTake({ handoff: true, heldBy: 'b2' }, { uid: 'b1' }), false);
  assert.equal(mayTake({ handoff: true, heldBy: 'b2' }, { uid: 'm', isManager: true }), true, 'the manager can take it from a broker');
  assert.equal(mayTake({ optedOut: true }, { uid: 'b1' }), false);
  assert.equal(mayRelease({ handoff: true, heldBy: 'b2' }, { uid: 'b1' }), false);
  assert.equal(mayRelease({ handoff: true, heldBy: HELD_BY_APP }, { uid: 'b1' }), true);
  assert.deepEqual(timeline({ turns: [{ role: 'customer', text: 'a', at: '2026-10-16T20:00:00Z' }], controlLog: [{ type: 'TAKEN', at: '2026-10-16T20:01:00Z' }] }).map(e => e.kind), ['message', 'control']);
});

test('a broker takes one conversation over: the agent stops there only, the other client is still answered', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  await turn(f, 'b1', 'أبحث عن فيلا', '966500000002');
  assert.equal(f.sends().length, 2);
  const taken = await take(f, BROKER);
  assert.equal(taken.conversation.mode, CONTROL_MODE.HUMAN);
  assert.equal(taken.conversation.heldByMe, true);
  await turn(f, 'a2', 'شراء');
  await turn(f, 'b2', 'شراء', '966500000002');
  assert.equal(f.sends().length, 3, 'only the other conversation got an automated reply');
  assert.equal(f.sends().at(-1).body.to, '966500000002');
  const held = await f.conversation();
  assert.ok(held.turns.some(t => t.role === 'customer' && t.text === 'شراء'), 'what the client said while held stays in the thread');
  assert.ok((await f.audits()).includes('WHATSAPP_CONVERSATION_TAKEN'));
});

test('two brokers press «استلام» at once: one wins, the other gets 409 — never a silent overwrite', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  const c = await f.conversation();
  const results = await Promise.allSettled([
    controlWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, action: 'take', expectedVersion: 0, requestKey: 'take-broker-1' }),
    controlWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: OTHER, conversationId: c.id, action: 'take', expectedVersion: 0, requestKey: 'take-broker-2' })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  const winner = (await f.conversation()).heldBy;
  assert.ok(['broker-1', 'broker-2'].includes(winner));
  // The loser no longer sees a conversation another broker answers; the manager still does.
  const loser = winner === 'broker-1' ? OTHER : BROKER;
  assert.equal((await listWhatsAppConversations(f.ctx, { officeId: 'office-a', actor: loser })).conversations.length, 0);
  await assert.rejects(getWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: loser, conversationId: c.id }), e => e.status === 403);
  assert.equal((await listWhatsAppConversations(f.ctx, { officeId: 'office-a', actor: MANAGER })).conversations[0].heldBy, winner);
});

test('the broker replies from the screen: only while holding it, once per request, recorded and audited', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  const c = await f.conversation();
  await assert.rejects(replyInWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, text: 'مرحبا', requestKey: 'reply-0001' }), e => e.code === 'conversation_not_held_by_you');
  await take(f, BROKER);
  const before = f.sends().length;
  const first = await replyInWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, text: 'أهلًا، معك الوسيط. عندي عرضان قريبان من طلبك.', requestKey: 'reply-0001' });
  const again = await replyInWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, text: 'أهلًا، معك الوسيط. عندي عرضان قريبان من طلبك.', requestKey: 'reply-0001' });
  assert.equal(first.delivery.state, 'SENT');
  assert.equal(again.delivery.duplicate, true);
  assert.equal(f.sends().length, before + 1, 'a double tap sends once');
  assert.equal(f.sends().at(-1).body.to, '966500000001');
  assert.equal(first.conversation.timeline.filter(e => e.role === 'broker').length, 1);
  assert.ok((await f.audits()).includes('WHATSAPP_CONVERSATION_REPLIED'));
  await assert.rejects(replyInWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: OTHER, conversationId: c.id, text: 'x', requestKey: 'reply-0002' }), e => e.status === 403);
});

test('hand back: the agent resumes with the same context and nothing the client already got is sent again', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  await take(f, BROKER);
  await turn(f, 'a2', 'شراء');
  const sentBefore = f.sends().length;
  const draftBefore = (await f.conversation()).draft;
  const c = await f.conversation();
  const back = await controlWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, action: 'release', expectedVersion: c.controlVersion, requestKey: 'release-broker-1' });
  assert.equal(back.conversation.mode, CONTROL_MODE.AI);
  f.advance(60000); await drainWhatsAppQueue(f.ctx);
  assert.equal(f.sends().length, sentBefore, 'the message received while held is not answered late');
  assert.deepEqual((await f.conversation()).draft, draftBefore, 'the request so far is kept');
  await turn(f, 'a3', 'في الرياض حي الملقا');
  assert.equal(f.sends().length, sentBefore + 1, 'the next client message is answered by the agent again');
  assert.ok((await f.audits()).includes('WHATSAPP_CONVERSATION_RELEASED'));
  // A stale screen cannot hand back or take with an old version.
  await assert.rejects(controlWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, action: 'take', expectedVersion: c.controlVersion, requestKey: 'take-stale-1' }), e => e.code === 'conversation_changed');
});

test('a reply from the WhatsApp Business app (coexistence echo) stops the agent in that conversation, once per echo', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  const sent = f.sends().length;
  await ingestWhatsAppEvents(f.ctx, echo('echo-1', 'أهلًا، أنا من المكتب'));
  await ingestWhatsAppEvents(f.ctx, echo('echo-1', 'أهلًا، أنا من المكتب'));
  const c = await f.conversation();
  assert.equal(c.handoff, true);
  assert.equal(c.heldBy, HELD_BY_APP);
  assert.equal(c.turns.filter(t => t.role === 'broker' && t.via === 'app').length, 1, 'the echo is recorded once');
  await turn(f, 'a2', 'شراء');
  assert.equal(f.sends().length, sent, 'no automated reply over the person');
  assert.ok((await f.audits()).includes('WHATSAPP_CONVERSATION_TAKEN_IN_APP'));
  // From the screen a broker can take it (to reply here) or hand it back to the agent.
  const view = (await listWhatsAppConversations(f.ctx, { officeId: 'office-a', actor: BROKER })).conversations.find(x => x.id === c.id);
  assert.equal(view.heldByApp, true);
  assert.equal(view.canRelease, true);
});

test('outside the 24-hour window the broker cannot send free text (an approved template would be required)', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  await take(f, BROKER);
  const before = f.sends().length;
  f.advance(86_400_001);
  const c = await f.conversation();
  const r = await replyInWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, text: 'مرحبا', requestKey: 'reply-late-1' });
  assert.equal(r.delivery.state, 'TEMPLATE_REQUIRED');
  assert.equal(f.sends().length, before);
  assert.equal(r.conversation.canReply, false);
});

test('economic test mode: the broker reply is simulated, never sent', async () => {
  const f = fixture();
  await turn(f, 'a1', 'أبحث عن شقة');
  await take(f, BROKER);
  f.ctx.env.ECONOMIC_TEST_MODE = 'enabled';
  const before = f.sends().length;
  const c = await f.conversation();
  const r = await replyInWhatsAppConversation(f.ctx, { officeId: 'office-a', actor: BROKER, conversationId: c.id, text: 'مرحبا', requestKey: 'reply-sim-1' });
  assert.equal(r.delivery.state, 'SIMULATED');
  assert.equal(f.sends().length, before);
});
