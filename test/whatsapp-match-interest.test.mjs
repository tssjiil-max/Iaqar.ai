import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareWhatsAppMatchInterest as prepare, recordSimulatedMatchInterest as answer, simulateWhatsAppMatchInterests as sweep } from '../worker/src/office-os/whatsapp-match-interest.js';

function fixture() {
  const docs = new Map();
  const put = (p, d) => docs.set(p.join('/'), structuredClone(d));
  const store = {
    async get(p) { return structuredClone(docs.get(p.join('/')) || null); },
    async create(p, d) { if (docs.has(p.join('/'))) return false; put(p, d); return true; },
    async update(p, fn) { const current = await this.get(p), patch = fn(current); if (patch) put(p, { ...current, ...patch }); return { current, patch }; },
    async list(p, limit) { return [...docs].filter(([k]) => k.startsWith(p.join('/') + '/') && k.split('/').length === p.length + 1).slice(0, limit).map(([k, d]) => ({ ...d, id: k.split('/').at(-1) })); }
  };
  const ctx = { store, now: () => new Date('2026-10-27T10:00:00Z'), env: { DEPLOYMENT_ENV: 'staging', FIREBASE_PROJECT_ID: 'iaqar-ai-staging', WHATSAPP_MATCH_INTEREST_MODE: 'simulate' }, deps: { sha256Hex: async s => createHash('sha256').update(s).digest('hex') } };
  const root = ['offices', 'a'];
  put([...root, 'integrations', 'whatsapp'], { autoReplyEnabled: true });
  put([...root, 'matches', 'm'], { officeId: 'a', status: 'active', isCurrent: true, integrityStatus: 'valid', score: 90, offerId: 'o', requestId: 'r', dataVersion: 'v1' });
  for (const [id, phone, kind] of [['o', '0501111111', 'OFFER'], ['r', '0502222222', 'REQUEST']]) put([...root, 'opportunities', id], { officeId: 'a', lifecycleStatus: 'ACTIVE', opportunityKind: kind, advertiserRole: kind === 'OFFER' ? 'OWNER' : 'CLIENT', contactPhone: phone, contactName: 'اسم سري', propertyType: 'شقة', city: 'المدينة', district: 'شوران', priceOrBudget: 600000.5, version: 1 });
  const ask = () => prepare(ctx, { officeId: 'a', matchId: 'm' });
  const reply = (id, role, value = 'yes', phone = role === 'owner' ? '0501111111' : '0502222222') => answer(ctx, { officeId: 'a', id, role, phone, answer: value });
  return { ctx, docs, put, root, ask, reply };
}

test('WhatsApp prepares both questions without Telegram, private contacts or money rounding', async () => {
  const f = fixture(), r = await f.ask(); assert.ok(r.id);
  const d = await f.ctx.store.get([...f.root, 'whatsappMatchInterest', r.id]);
  assert.equal(d.owner.delivery, 'SIMULATED'); assert.equal(d.client.delivery, 'SIMULATED');
  assert.match(d.client.text, /600000\.5/); assert.doesNotMatch(d.client.text + d.owner.text, /اسم سري|0501111111|0502222222/);
  assert.equal((await f.ask()).duplicate, true);
});
test('both explicit yeses confirm only interest, never approve a match or create a deal', async () => {
  const f = fixture(), { id } = await f.ask();
  assert.equal((await f.reply(id, 'client')).state, 'AWAITING_INTEREST');
  assert.equal((await f.reply(id, 'owner')).state, 'INTEREST_CONFIRMED');
  assert.equal((await f.reply(id, 'owner')).duplicate, true);
  assert.equal((await f.ctx.store.get([...f.root, 'matches', 'm'])).brokerDecision, undefined);
  assert.equal([...f.docs.keys()].some(k => /journeys|deals/.test(k)), false);
});
test('a decline ends interest; later or repeated answers cannot reverse it', async () => {
  const f = fixture(), { id } = await f.ask();
  assert.equal((await f.reply(id, 'owner', 'no')).state, 'DECLINED');
  assert.equal((await f.reply(id, 'client')).state, 'DECLINED');
});
test('wrong party and cross-office replies are refused', async () => {
  const f = fixture(), { id } = await f.ask();
  assert.equal((await f.reply(id, 'client', 'yes', '0509999999')).reason, 'wrong_party');
  assert.equal((await answer(f.ctx, { officeId: 'b', id, role: 'client', phone: '0502222222', answer: 'yes' })).reason, 'wrong_party');
});
test('a new price invalidates earlier interest without using a stale yes', async () => {
  const f = fixture(), { id } = await f.ask(); await f.reply(id, 'client');
  const p = [...f.root, 'opportunities', 'o']; f.put(p, { ...await f.ctx.store.get(p), priceOrBudget: 650000.75, version: 2 });
  assert.equal((await f.reply(id, 'owner')).reason, 'stale_match');
  assert.notEqual((await f.ask()).id, id);
});
test('off switch, production and disabled mode never start questions', async () => {
  for (const patch of [{ WHATSAPP_MATCH_INTEREST_MODE: '' }, { DEPLOYMENT_ENV: 'production' }, { FIREBASE_PROJECT_ID: 'aqar-b5d76' }]) {
    const f = fixture(); Object.assign(f.ctx.env, patch); assert.equal((await f.ask()).disabled, true);
  }
  const f = fixture(), { id } = await f.ask(); f.put([...f.root, 'integrations', 'whatsapp'], { autoReplyEnabled: false });
  assert.equal((await f.reply(id, 'client')).reason, 'automation_off'); assert.equal((await f.ask()).disabled, true);
});
test('weak, superseded, already decided and inactive matches stay out', async () => {
  for (const patch of [{ score: 40 }, { isCurrent: false }, { brokerDecision: 'REJECTED' }, { integrityStatus: 'invalid' }, { officeId: 'b' }]) {
    const f = fixture(), p = [...f.root, 'matches', 'm']; f.put(p, { ...await f.ctx.store.get(p), ...patch });
    assert.equal((await f.ask()).skipped, 'match_not_eligible');
  }
  const f = fixture(), p = [...f.root, 'opportunities', 'o']; f.put(p, { ...await f.ctx.store.get(p), lifecycleStatus: 'ARCHIVED' });
  assert.equal((await f.ask()).skipped, 'match_not_eligible');
});
test('sweep creates one check and replay creates none', async () => {
  const f = fixture(); assert.equal((await sweep(f.ctx, { officeId: 'a' })).prepared, 1);
  assert.equal((await sweep(f.ctx, { officeId: 'a' })).prepared, 0);
});
