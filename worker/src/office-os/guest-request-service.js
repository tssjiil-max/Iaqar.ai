/**
 * Guest «أرسل طلبك للمكاتب» and the scope options behind the public search page. No account.
 *
 *   options  → the participating offices (public profile only) and the cities they serve.
 *   request  → one request, saved separately in each chosen office's own request bank (≤3 offices),
 *              through the same save path as the office and the WhatsApp agent (validation, duplicates,
 *              matching). One public reference per request; a retry or double tap returns the same one.
 *
 * Contact data reaches only the offices the guest chose, after two explicit consents. Nothing is sent
 * to the guest by any channel from here, and no offer is published by anything in this file.
 */
import { priceOf, validateRecordInput } from '../../../public/os/domain/records-domain.js';
import { notesWithDistricts } from '../../../public/os/domain/smart-fill-domain.js';
import { guestScope, guestReference, requestGaps } from '../../../public/os/domain/guest-search-domain.js';
import { whatsappDigits } from '../../../public/os/domain/format-domain.js';
import { consumePublicRateLimit, publicRateLimitKey } from '../public-rate-limit.js';
import { saveRecord } from './records-service.js';
import { notifyOffice } from './bot-notify.js';

const clean = (v, n = 100) => String(v ?? '').trim().slice(0, n);
const sameText = (a, b) => clean(a).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه') === clean(b).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
function rate(ctx, ip, action, limit) {
  if (!consumePublicRateLimit(publicRateLimitKey({ route: `guest-${action}`, ip, officeId: '' }), { limit, windowMs: 60000 }).ok) throw ctx.deps.appError('rate_limited', 429, 'محاولات كثيرة، حاول بعد قليل');
}
const officeIdOf = (ctx, value) => { const id = clean(value, 80); if (id && !/^[a-zA-Z0-9_-]+$/.test(id)) throw ctx.deps.appError('office_invalid', 400, 'رابط المكتب غير صالح'); return id; };
async function activeOffice(ctx, id) {
  const o = await ctx.store.get(['publicOffices', id]);
  if (!o || o.active === false) throw ctx.deps.appError('office_not_found', 404, 'المكتب غير متاح');
  return { ...o, id };
}
/** The public face of an office: never its phone, members or settings. */
const card = (o) => ({ id: o.id, officeName: clean(o.officeName, 120) || 'مكتب عقاري', city: clean(o.city, 60), brokerName: clean(o.brokerName, 80), logoUrl: /^https:\/\//.test(String(o.logoUrl || '')) ? clean(o.logoUrl, 600) : '', publicSlug: clean(o.publicSlug, 80) });

export async function guestSearchOptions(ctx, { input = {}, ip = '' }) {
  rate(ctx, ip, 'options', 60);
  const officeId = officeIdOf(ctx, input.officeId);
  const home = officeId ? await activeOffice(ctx, officeId) : null;
  const all = (await ctx.store.list(['publicOffices'], 50)).filter((o) => o.active !== false);
  const cities = [...new Set(all.map((o) => clean(o.city, 60)).filter(Boolean))];
  return {
    ok: true,
    offices: all.map(card),
    cities,
    home: home ? { ...card(home), allowExpand: home.publicSearchExpand !== false, districts: Object.keys(home.districtCenters || {}).slice(0, 60) } : null,
    limits: { districts: 3, offices: 3 }
  };
}

/** Who in the office owns a guest request: the office's default broker, else its owner (never the guest's choice). */
async function receivingActor(ctx, officeId) {
  const office = await ctx.store.get(['offices', officeId]).catch(() => null) || {};
  const assignment = await ctx.store.get(['offices', officeId, 'officeSettings', 'assignment']).catch(() => null);
  return { uid: clean(assignment?.defaultBrokerId || office.ownerUid, 128) || 'public-search', role: 'broker', isManager: false };
}

export async function submitGuestRequest(ctx, { input = {}, ip = '' }) {
  rate(ctx, ip, 'request', 20);
  const requestKey = clean(input.requestKey, 100);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey)) throw ctx.deps.appError('request_key_required', 400, 'أعد فتح الصفحة وحاول مجددًا');
  const homeId = officeIdOf(ctx, input.officeId);
  const criteria = input.criteria && typeof input.criteria === 'object' ? input.criteria : {};
  const scope = guestScope({ districts: criteria.districts, district: criteria.district, officeIds: Array.isArray(input.officeIds) && input.officeIds.length ? input.officeIds : homeId ? [homeId] : [] });
  if (!scope.ok) throw ctx.deps.appError('scope_invalid', 400, scope.error);
  if (!scope.officeIds.length) throw ctx.deps.appError('offices_required', 400, 'اختر مكتبًا واحدًا على الأقل لإرسال طلبك');
  if (homeId) {
    const home = await activeOffice(ctx, homeId);
    if (home.publicSearchExpand === false && scope.officeIds.some((id) => id !== homeId)) throw ctx.deps.appError('scope_invalid', 400, 'هذا الرابط يرسل الطلب لهذا المكتب فقط');
  }
  if (input.consentProcessing !== true || input.consentContact !== true) throw ctx.deps.appError('consent_required', 400, 'الموافقة على معالجة الطلب ومشاركته والتواصل مطلوبة');
  const name = clean(input.name, 80);
  if (name.length < 2) throw ctx.deps.appError('name_required', 400, 'اكتب اسمك');
  const phoneDigits = whatsappDigits(input.phone);
  if (!phoneDigits) throw ctx.deps.appError('phone_invalid', 400, 'اكتب رقم جوال سعودي يبدأ بـ 05');
  const full = { ...criteria, districts: scope.districts, district: scope.districts[0] || '' };
  const gaps = requestGaps(full);
  if (gaps.length) {
    const error = ctx.deps.appError('request_incomplete', 400, `أكمل ${gaps.map((g) => g.label).join('، ')} لإرسال طلبك`);
    error.details = Object.fromEntries(gaps.map((g) => [g.key, g.label]));
    throw error;
  }
  const text = clean(input.text, 900);
  const record = {
    kind: 'REQUEST', purpose: full.purpose, propertyType: full.propertyType, city: full.city, district: full.district, price: full.price,
    area: full.area, rooms: full.rooms, contactName: name, contactPhone: `0${phoneDigits.slice(3)}`,
    notes: notesWithDistricts(text, scope.districts.slice(1))
  };
  const check = validateRecordInput(record, { requireName: true });
  if (!check.ok) throw ctx.deps.appError('request_invalid', 400, Object.values(check.errors)[0]);
  const offices = await Promise.all(scope.officeIds.map((id) => activeOffice(ctx, id)));

  const hex = await ctx.deps.sha256Hex(`guest-request|${requestKey}`);
  const reference = guestReference(hex);
  const path = ['publicRequests', hex.slice(0, 40)];
  const now = ctx.now();
  // The reference document holds no contact data: only where the request went.
  const claimed = await ctx.store.create(path, { reference, status: 'SENDING', officeIdsJson: JSON.stringify(scope.officeIds), createdAt: now });
  if (!claimed) {
    const previous = await ctx.store.get(path);
    if (previous?.status === 'SENT') return { ok: true, duplicate: true, reference: previous.reference, offices: JSON.parse(previous.resultJson || '[]') };
  }
  const sent = [];
  const notify = (officeId, key, title, body, opportunityId) => {
    const job = notifyOffice(ctx.store, ctx.deps, { officeId, key: `${key}:${hex.slice(0, 24)}`, title, body, route: 'repo', opportunityId, now })
      .catch((error) => console.warn('[guest-request] office notify failed', error?.message));
    return ctx.waitUntil ? ctx.waitUntil(job) : job;
  };
  for (const office of offices) {
    const actor = await receivingActor(ctx, office.id);
    const created = [], changed = [];
    let existing = 0;
    // One request per accepted district: matching reads one district per record, so each district is matched
    // for real. All of them carry the same public reference; the other districts stay named in the notes.
    for (const [i, district] of scope.districts.entries()) {
      const input = { ...record, district, notes: notesWithDistricts(text, scope.districts.filter((d) => d !== district)) };
      // Same save path as the office itself: validation, duplicate detection (same phone + request), then matching.
      const saved = await saveRecord(ctx, { actor, officeId: office.id, requestKey: `guest-${hex.slice(0, 24)}-${i}`, input: { ...input, intakeOrigin: { channel: 'OTHER', role: 'CLIENT', method: text ? 'SMART_FILL' : 'MANUAL', text } } });
      const recordPath = ['offices', office.id, 'opportunities', saved.recordId];
      if (saved.duplicate && saved.duplicateMessage) {
        // The office already holds this client's request for this district. It is never overwritten from a public
        // page (a broker may have refined it); different criteria reach the office as a notice for review.
        existing++;
        const row = await ctx.store.get(recordPath);
        const differs = row && (priceOf(row) !== check.value.price || !sameText(row.city, check.value.city)
          || (check.value.rooms && Number(row.rooms) !== check.value.rooms) || (check.value.area && Number(row.area) !== check.value.area));
        if (differs) { changed.push({ recordId: saved.recordId, district }); continue; }
      } else if (!saved.duplicate) created.push({ recordId: saved.recordId, district });
      await ctx.store.update(recordPath, () => ({
        publicRequestReference: reference, publicRequestSource: 'public_search', consentProcessing: true, consentContact: true, consentAt: now
      }));
    }
    if (created.length) await notify(office.id, 'guest-request', 'طلب عميل جديد من البحث العقاري', `${name} — ${record.propertyType} في ${created.map((c) => c.district).join('، ')} (المرجع ${reference})`, created[0].recordId);
    if (changed.length) await notify(office.id, 'guest-request-changed', 'عميل أعاد إرسال طلبه بمواصفات مختلفة', `${name} — ${record.propertyType} في ${changed.map((c) => c.district).join('، ')}: الميزانية ${check.value.price.toLocaleString('en-US')} ريال${check.value.rooms ? ` · ${check.value.rooms} غرف` : ''}${check.value.area ? ` · ${check.value.area} م²` : ''}. راجع الطلب الحالي (المرجع ${reference}).`, changed[0].recordId);
    sent.push({ officeId: office.id, officeName: clean(office.officeName, 120) || 'مكتب عقاري', requests: scope.districts.length, duplicate: existing > 0 && !created.length, changedForReview: changed.length > 0 });
  }
  await ctx.store.set(path, { reference, status: 'SENT', officeIdsJson: JSON.stringify(scope.officeIds), resultJson: JSON.stringify(sent), createdAt: now, sentAt: ctx.now() });
  return { ok: true, duplicate: false, reference, offices: sent };
}
