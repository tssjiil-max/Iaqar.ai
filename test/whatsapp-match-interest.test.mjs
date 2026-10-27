import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareWhatsAppMatchInterest as prepare, recordSimulatedMatchInterest as answer, simulateWhatsAppMatchInterests as sweep, recordWhatsAppMatchInterest, runWhatsAppMatchInterests, startWhatsAppInterestFollowUp } from '../worker/src/office-os/whatsapp-match-interest.js';

function fixture() {
  const docs = new Map();
  const put = (p, d) => docs.set(p.join('/'), structuredClone(d));
  const store = {
    async get(p) { return structuredClone(docs.get(p.join('/')) || null); },
    async set(p, d) { put(p, { ...await this.get(p), ...d }); },
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

async function liveFixture() {
  const f = fixture(); f.ctx.env.WHATSAPP_MATCH_INTEREST_MODE = 'enabled';
  f.ctx.deps.appError = (code, status, message) => Object.assign(Error(message), {code,status});
  for(const [id,phone] of [['owner','0501111111'],['client','0502222222']]) f.put([...f.root,'whatsappConversations',id],{officeId:'a',senderPhone:phone,consent:true});
  const sent=[];
  await runWhatsAppMatchInterests(f.ctx,{officeId:'a',send:async args=>{sent.push(args);return {id:`out-${args.role}`,state:'SENT'};}});
  const id=sent[0].id;
  const reply=(role,answer='yes',phone=role==='owner'?'0501111111':'0502222222')=>recordWhatsAppMatchInterest(f.ctx,{officeId:'a',id,role,answer,phone});
  return {...f,id,sent,liveReply:reply};
}

test('two verified delivered WhatsApp interest replies open exactly one existing journey and one follow-up',async()=>{
  const f=await liveFixture();assert.equal(f.sent.length,2);
  assert.equal((await f.liveReply('client')).state,'AWAITING_INTEREST');
  assert.equal([...f.docs.keys()].some(k=>k.includes('/journeys/')),false);
  assert.equal((await f.liveReply('owner')).state,'FOLLOW_UP_STARTED');
  const journeys=await f.ctx.store.list([...f.root,'journeys'],100);
  assert.equal(journeys.length,1);assert.equal(journeys[0].status,'ACTIVE');
  assert.equal(journeys[0].session?.agreedPrice,undefined);assert.equal(journeys[0].outcome,undefined);
  assert.equal((await f.liveReply('owner')).duplicate,true);
  const operations=await f.ctx.store.list([...f.root,'operations'],100);
  assert.equal(operations.filter(t=>t.type==='JOURNEY_FOLLOW_UP').length,1);
  assert.equal((await startWhatsAppInterestFollowUp(f.ctx,{officeId:'a',id:f.id})).duplicate,true);
});
test('uncertain delivery never authorizes a reply or starts follow-up',async()=>{
  const f=await liveFixture(),p=[...f.root,'whatsappMatchInterest',f.id],d=await f.ctx.store.get(p);
  f.put(p,{...d,owner:{...d.owner,delivery:'DELIVERY_UNKNOWN'}});
  assert.equal((await f.liveReply('owner')).reason,'wrong_or_unasked_party');
  assert.equal((await startWhatsAppInterestFollowUp(f.ctx,{officeId:'a',id:f.id})).reason,'both_interests_required');
});
test('human takeover prevents automatic follow-up even if both parties say yes',async()=>{
  const f=await liveFixture();await f.liveReply('client');
  f.put([...f.root,'whatsappConversations','owner'],{officeId:'a',senderPhone:'0501111111',consent:true,handoff:true});
  assert.equal((await f.liveReply('owner')).state,'INTEREST_CONFIRMED');
  assert.equal((await startWhatsAppInterestFollowUp(f.ctx,{officeId:'a',id:f.id})).reason,'party_stopped_or_human');
  assert.equal((await f.ctx.store.list([...f.root,'journeys'],100)).length,0);
});
test('declined or stale live checks cannot start a journey',async()=>{
  const f=await liveFixture();assert.equal((await f.liveReply('client','no')).state,'DECLINED');
  assert.equal((await f.liveReply('owner')).state,'DECLINED');
  assert.equal((await f.ctx.store.list([...f.root,'journeys'],100)).length,0);
  const g=await liveFixture();await g.liveReply('client');
  const p=[...g.root,'opportunities','o'];g.put(p,{...await g.ctx.store.get(p),version:2,priceOrBudget:700000.75});
  assert.equal((await g.liveReply('owner')).reason,'stale_match');
  assert.equal((await g.ctx.store.list([...g.root,'journeys'],100)).length,0);
});
