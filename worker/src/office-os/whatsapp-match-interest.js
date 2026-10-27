/** WhatsApp match qualification. Simulation stays separate from confirmed live replies. */
import { lifecycleOf, LIFECYCLE, priceOf } from '../../../public/os/domain/records-domain.js';
import { isOpenForMatching } from '../../../public/os/domain/validity-domain.js';
import { cooperationEligible } from '../../../public/os/domain/external-broker-domain.js';
import { whatsappDigits } from '../../../public/os/domain/format-domain.js';
import { applyJourneyChange, decideMatchReview, journeyIdForPair } from './journey-service.js';

const enabled = ctx => ['simulate', 'enabled'].includes(ctx.env.WHATSAPP_MATCH_INTEREST_MODE)
  && ctx.env.DEPLOYMENT_ENV === 'staging' && ctx.env.FIREBASE_PROJECT_ID === 'iaqar-ai-staging';
const path = (officeId, id) => ['offices', officeId, 'whatsappMatchInterest', id];
const clean = value => String(value || '').trim();

async function snapshot(ctx, officeId, matchId, { recovery = false } = {}) {
  const match = await ctx.store.get(['offices', officeId, 'matches', matchId]);
  const ownApproval = recovery && match?.brokerDecision === 'APPROVED' && match?.brokerDecisionBy === 'whatsapp-interest';
  if (!match || match.officeId !== officeId || match.isCurrent === false || (!ownApproval && match.status !== 'active')
    || (!ownApproval && match.brokerDecision) || match.integrityStatus !== 'valid' || !(Number(match.score) >= 75)) return null;
  const offerId = clean(match.offerId || match.ownerOfferId), requestId = clean(match.requestId || match.clientRequestId);
  if (!offerId || !requestId || offerId === requestId) return null;
  const [offer, request] = await Promise.all([offerId, requestId].map(id => ctx.store.get(['offices', officeId, 'opportunities', id])));
  if (![offer, request].every(row => row && row.officeId === officeId && lifecycleOf(row) === LIFECYCLE.ACTIVE
    && isOpenForMatching(row, ctx.now()) && cooperationEligible(row))) return null;
  const ownerPhone = whatsappDigits(offer.contactPhone || offer.phone), clientPhone = whatsappDigits(request.contactPhone || request.phone);
  if (!ownerPhone || !clientPhone || ownerPhone === clientPhone) return null;
  // Any record version/price change invalidates earlier interest; no old yes can approve a new price.
  const fingerprint = await ctx.deps.sha256Hex(JSON.stringify([matchId, match.dataVersion || '', offerId,
    offer.version || 0, priceOf(offer), requestId, request.version || 0, priceOf(request), ownerPhone, clientPhone]));
  return { matchId, offerId, requestId, fingerprint, ownerPhone, clientPhone, offer, request, match };
}

/** Build two internal questions once per current match snapshot. SIMULATED never means SENT. */
export async function prepareWhatsAppMatchInterest(ctx, { officeId, matchId }) {
  if (!enabled(ctx)) return { ok: true, disabled: true };
  const settings = await ctx.store.get(['offices', officeId, 'integrations', 'whatsapp']);
  if (settings?.autoReplyEnabled !== true) return { ok: true, disabled: true };
  const s = await snapshot(ctx, officeId, matchId);
  if (!s) return { ok: true, skipped: 'match_not_eligible' };
  const id = `wi_${s.fingerprint.slice(0, 40)}`;
  const location = [s.offer.propertyType, s.offer.city, s.offer.district].filter(Boolean).join(' — ');
  const price = priceOf(s.offer);
  const mode = ctx.env.WHATSAPP_MATCH_INTEREST_MODE === 'enabled' ? 'LIVE' : 'SIMULATED';
  const delivery = mode === 'LIVE' ? 'PENDING' : 'SIMULATED';
  const created = await ctx.store.create(path(officeId, id), {
    officeId, id, matchId, fingerprint: s.fingerprint, offerId: s.offerId, requestId: s.requestId,
    state: 'AWAITING_INTEREST', mode, replies: {},
    owner: { phone: s.ownerPhone, text: `بخصوص ${location} بسعر ${price} ريال: هل العقار متوفر والسعر صحيح، وترغب بمتابعة عميل مناسب؟`, delivery },
    client: { phone: s.clientPhone, text: `يوجد عرض ${location} بسعر ${price} ريال. هل يناسبك وترغب بالمتابعة؟`, delivery },
    createdAt: ctx.now(), updatedAt: ctx.now()
  });
  return { ok: true, id, duplicate: !created, mode };
}

/** Test-only reply path. No HTTP endpoint exposes it and it never changes the match/deal. */
export async function recordSimulatedMatchInterest(ctx, { officeId, id, role, phone, answer }) {
  if (!enabled(ctx) || ctx.env.WHATSAPP_MATCH_INTEREST_MODE !== 'simulate') return { ok: false, reason: 'simulation_disabled' };
  if (!['owner', 'client'].includes(role) || !['yes', 'no'].includes(answer)) return { ok: false, reason: 'invalid_answer' };
  const doc = await ctx.store.get(path(officeId, id));
  if (!doc || doc.officeId !== officeId || doc.mode !== 'SIMULATED'
    || doc[role]?.phone !== whatsappDigits(phone)) return { ok: false, reason: 'wrong_party' };
  if ((await ctx.store.get(['offices', officeId, 'integrations', 'whatsapp']))?.autoReplyEnabled !== true) return { ok: false, reason: 'automation_off' };
  const current = await snapshot(ctx, officeId, doc.matchId);
  if (!current || current.fingerprint !== doc.fingerprint) return { ok: false, reason: 'stale_match' };
  const result = await ctx.store.update(path(officeId, id), row => {
    if (row.state !== 'AWAITING_INTEREST' || row.replies?.[role]) return null;
    const replies = { ...row.replies, [role]: { answer, at: ctx.now().toISOString() } };
    const state = answer === 'no' ? 'DECLINED' : replies.owner?.answer === 'yes' && replies.client?.answer === 'yes'
      ? 'INTEREST_CONFIRMED' : 'AWAITING_INTEREST';
    return { replies, state, updatedAt: ctx.now() };
  });
  return { ok: true, duplicate: !result?.patch, state: result?.patch?.state || result?.current?.state, mode: 'SIMULATED' };
}

/** Bounded local rollout; Telegram configuration is deliberately irrelevant. */
export async function simulateWhatsAppMatchInterests(ctx, { officeId }) {
  if (!enabled(ctx)) return { prepared: 0, disabled: true };
  const matches = await ctx.store.list(['offices', officeId, 'matches'], 25);
  let prepared = 0;
  for (const match of matches.slice(0, 25)) {
    const result = await prepareWhatsAppMatchInterest(ctx, { officeId, matchId: match.id });
    if (result.id && !result.duplicate) prepared++;
  }
  return { prepared, mode: 'SIMULATED' };
}

const live = ctx => enabled(ctx) && ctx.env.WHATSAPP_MATCH_INTEREST_MODE === 'enabled';
const SYSTEM = Object.freeze({ uid: 'whatsapp-interest', role: 'system', isManager: true });

/** Called only inside the verified WhatsApp inbound pipeline; never by a public approval route. */
export async function recordWhatsAppMatchInterest(ctx, { officeId, id, role, phone, answer }) {
  if (!live(ctx)) return { ok: false, reason: 'automation_disabled' };
  if (!['owner', 'client'].includes(role) || !['yes', 'no'].includes(answer)) return { ok: false, reason: 'invalid_answer' };
  const p = path(officeId, id), doc = await ctx.store.get(p);
  if (!doc || doc.officeId !== officeId || doc.mode !== 'LIVE' || doc[role]?.phone !== whatsappDigits(phone)
    || doc[role]?.delivery !== 'SENT') return { ok: false, reason: 'wrong_or_unasked_party' };
  if ((await ctx.store.get(['offices', officeId, 'integrations', 'whatsapp']))?.autoReplyEnabled !== true) return { ok: false, reason: 'automation_off' };
  const s = await snapshot(ctx, officeId, doc.matchId, { recovery: true });
  if (!s || s.fingerprint !== doc.fingerprint) return { ok: false, reason: 'stale_match' };
  const changed = await ctx.store.update(p, row => {
    if (row.state !== 'AWAITING_INTEREST' || row.replies?.[role]) return null;
    const replies = { ...row.replies, [role]: { answer, at: ctx.now().toISOString() } };
    return { replies, state: answer === 'no' ? 'DECLINED' : replies.owner?.answer === 'yes' && replies.client?.answer === 'yes'
      ? 'INTEREST_CONFIRMED' : 'AWAITING_INTEREST', updatedAt: ctx.now() };
  });
  const row = changed?.patch ? { ...changed.current, ...changed.patch } : changed?.current;
  if (row?.state === 'INTEREST_CONFIRMED') await startWhatsAppInterestFollowUp(ctx, { officeId, id });
  return { ok: true, duplicate: !changed?.patch, state: (await ctx.store.get(p))?.state };
}

/** Interest opens the existing journey and one follow-up; it never agrees a price or closes a deal. */
export async function startWhatsAppInterestFollowUp(ctx, { officeId, id }) {
  if (!live(ctx) || (await ctx.store.get(['offices', officeId, 'integrations', 'whatsapp']))?.autoReplyEnabled !== true) return { ok: false, reason: 'automation_off' };
  const p = path(officeId, id), row = await ctx.store.get(p);
  if (!row || row.officeId !== officeId || row.mode !== 'LIVE') return { ok: false, reason: 'interest_missing' };
  if (row.state === 'FOLLOW_UP_STARTED') return { ok: true, journeyId: row.journeyId, duplicate: true };
  if (row.state !== 'INTEREST_CONFIRMED' || !['owner', 'client'].every(role => row.replies?.[role]?.answer === 'yes' && row[role]?.delivery === 'SENT')) return { ok: false, reason: 'both_interests_required' };
  const conversations = await ctx.store.list(['offices', officeId, 'whatsappConversations'], 300);
  if (!['owner', 'client'].every(role => conversations.some(c => c.officeId === officeId && c.consent === true
    && !c.optedOut && !c.handoff && whatsappDigits(c.senderPhone) === row[role].phone))) return { ok: false, reason: 'party_stopped_or_human' };
  const s = await snapshot(ctx, officeId, row.matchId, { recovery: true });
  if (!s || s.fingerprint !== row.fingerprint) return { ok: false, reason: 'stale_match' };
  // Recover after a crash between journey persistence and the interest projection, using the canonical pair.
  const expected = await journeyIdForPair(ctx.deps, officeId, s.match.canonicalPairKey || row.matchId);
  const existing = await ctx.store.get(['offices', officeId, 'journeys', expected]);
  if (existing && (existing.status !== 'ACTIVE' || existing.approvedBy !== SYSTEM.uid)) return { ok: false, reason: 'journey_owned_elsewhere' };
  const result = await decideMatchReview(ctx, { actor: SYSTEM, officeId, matchId: row.matchId, decision: 'approve', viaBot: true, botChannel: 'whatsapp' });
  await applyJourneyChange(ctx, { officeId, journeyId: result.journeyId, actor: SYSTEM,
    mutate: j => j.interestCheckId === id ? null : { interestCheckId: id, interestConfirmedAt: ctx.now().toISOString() },
    add: [{ type: 'JOURNEY_FOLLOW_UP', ref: `interest:${id}`, reason: 'أكد الطرفان الاهتمام — نسّق المعاينة أو التفاوض حسب الحاجة، دون افتراض اتفاق نهائي', actionLabel: 'متابعة اهتمام الطرفين' }],
    event: { type: 'INTEREST_CONFIRMED', key: [id], source: 'system', actorRole: 'system', text: 'أكد الطرفان اهتمامهما عبر واتساب — بدأت المتابعة، ولم يُسجل اتفاق نهائي' }
  });
  await ctx.store.set(p, { state: 'FOLLOW_UP_STARTED', journeyId: result.journeyId, updatedAt: ctx.now() });
  return { ok: true, journeyId: result.journeyId };
}

/** The sender is the existing policy-checked WhatsApp outbox, injected to avoid a transport cycle. */
export async function runWhatsAppMatchInterests(ctx, { officeId, send }) {
  if (!live(ctx)) return simulateWhatsAppMatchInterests(ctx, { officeId });
  let prepared = 0;
  for (const match of (await ctx.store.list(['offices', officeId, 'matches'], 25)).slice(0, 25)) {
    const result = await prepareWhatsAppMatchInterest(ctx, { officeId, matchId: match.id });
    if (!result.id) continue;
    const p = path(officeId, result.id);
    if (!result.duplicate) prepared++;
    for (const role of ['owner', 'client']) {
      const row = await ctx.store.get(p);
      if (row.mode !== 'LIVE' || row.state !== 'AWAITING_INTEREST' || row[role].delivery !== 'PENDING') continue;
      const delivery = await send({ officeId, id: result.id, role, party: row[role] });
      await ctx.store.update(p, current => ({ [role]: { ...current[role], delivery: delivery.state, outboxId: delivery.id || '' }, updatedAt: ctx.now() }));
    }
  }
  // Retry only the internal follow-up after a partial write, never a question with uncertain delivery.
  for (const row of (await ctx.store.list(['offices', officeId, 'whatsappMatchInterest'], 25)).slice(0, 25)) {
    if (row.state === 'INTEREST_CONFIRMED') await startWhatsAppInterestFollowUp(ctx, { officeId, id: row.id });
  }
  return { prepared, mode: 'LIVE' };
}
