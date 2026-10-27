/** First rollout: persisted simulation only. No transport, approval or deal writes. */
import { lifecycleOf, LIFECYCLE, priceOf } from '../../../public/os/domain/records-domain.js';
import { isOpenForMatching } from '../../../public/os/domain/validity-domain.js';
import { cooperationEligible } from '../../../public/os/domain/external-broker-domain.js';
import { whatsappDigits } from '../../../public/os/domain/format-domain.js';

const enabled = ctx => ctx.env.WHATSAPP_MATCH_INTEREST_MODE === 'simulate'
  && ctx.env.DEPLOYMENT_ENV === 'staging' && ctx.env.FIREBASE_PROJECT_ID === 'iaqar-ai-staging';
const path = (officeId, id) => ['offices', officeId, 'whatsappMatchInterest', id];
const clean = value => String(value || '').trim();

async function snapshot(ctx, officeId, matchId) {
  const match = await ctx.store.get(['offices', officeId, 'matches', matchId]);
  if (!match || match.officeId !== officeId || match.isCurrent === false || match.status !== 'active'
    || match.brokerDecision || match.integrityStatus !== 'valid' || !(Number(match.score) >= 75)) return null;
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
  return { matchId, offerId, requestId, fingerprint, ownerPhone, clientPhone, offer, request };
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
  const created = await ctx.store.create(path(officeId, id), {
    officeId, id, matchId, fingerprint: s.fingerprint, offerId: s.offerId, requestId: s.requestId,
    state: 'AWAITING_INTEREST', mode: 'SIMULATED', replies: {},
    owner: { phone: s.ownerPhone, text: `بخصوص ${location} بسعر ${price} ريال: هل العقار متوفر والسعر صحيح، وترغب بمتابعة عميل مناسب؟`, delivery: 'SIMULATED' },
    client: { phone: s.clientPhone, text: `يوجد عرض ${location} بسعر ${price} ريال. هل يناسبك وترغب بالمتابعة؟`, delivery: 'SIMULATED' },
    createdAt: ctx.now(), updatedAt: ctx.now()
  });
  return { ok: true, id, duplicate: !created, mode: 'SIMULATED' };
}

/** Test-only reply path. No HTTP endpoint exposes it and it never changes the match/deal. */
export async function recordSimulatedMatchInterest(ctx, { officeId, id, role, phone, answer }) {
  if (!enabled(ctx)) return { ok: false, reason: 'simulation_disabled' };
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
