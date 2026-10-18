/**
 * Guest search scope and request rules, shared by the public page, the Worker and node:test.
 *   • Up to three districts and up to three offices; a fourth is refused, never silently dropped.
 *   • District names are compared by one key, so «حي درة العقيق», «دره العقيق» and «درة العقيق» are one district.
 *   • Sending a request to offices needs the criteria a request record needs; nothing is guessed to fill a gap.
 * No DOM, no network.
 */
import { normalizeInventoryDistrict } from './inventory-query-domain.js';

export const GUEST_LIMITS = Object.freeze({ districts: 3, offices: 3 });

/** One comparison key per district name: alef/yaa/taa-marbuta variants, «حي»/«مخطط», a leading «ال». */
export const districtKey = (name) => normalizeInventoryDistrict(name).replace(/^ال(?=\S{2})/, '');
export const sameDistrict = (a, b) => Boolean(districtKey(a)) && districtKey(a) === districtKey(b);

/** Clean, de-duplicated list (first spelling kept). `max` is enforced by the caller so a 4th can be reported. */
export function uniqueDistricts(values = []) {
  const out = [];
  for (const raw of Array.isArray(values) ? values : [values]) {
    const value = String(raw ?? '').trim().replace(/^(?:حي|مخطط)\s+/, '').slice(0, 80);
    if (value && !out.some((d) => sameDistrict(d, value))) out.push(value);
  }
  return out;
}

/** Add or remove one value from a limited selection. Adding past the limit is refused with a reason. */
export function toggleLimited(list = [], value, max, same = (a, b) => a === b) {
  const current = Array.isArray(list) ? list : [];
  if (current.some((x) => same(x, value))) return { list: current.filter((x) => !same(x, value)), changed: true, blocked: false };
  if (current.length >= max) return { list: current, changed: false, blocked: true };
  return { list: [...current, value], changed: true, blocked: false };
}

/**
 * The scope a guest sent: districts and offices, each at most three.
 * Returns { ok, districts, officeIds, error } — `error` is the Arabic message to show.
 */
export function guestScope({ districts = [], district = '', officeIds = [] } = {}) {
  const list = uniqueDistricts([...(Array.isArray(districts) ? districts : []), district].filter(Boolean));
  if (list.length > GUEST_LIMITS.districts) return { ok: false, districts: [], officeIds: [], error: 'اختر ثلاثة أحياء كحد أقصى' };
  const ids = [...new Set((Array.isArray(officeIds) ? officeIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) return { ok: false, districts: [], officeIds: [], error: 'مكتب غير صالح' };
  if (ids.length > GUEST_LIMITS.offices) return { ok: false, districts: [], officeIds: [], error: 'اختر ثلاثة مكاتب كحد أقصى' };
  return { ok: true, districts: list, officeIds: ids, error: '' };
}

/** Criteria a request record needs before it can enter an office's request bank. */
export const REQUEST_REQUIRED = Object.freeze([
  ['purpose', 'الغرض (شراء أو استئجار)'],
  ['propertyType', 'نوع العقار'],
  ['city', 'المدينة'],
  ['district', 'الحي'],
  ['price', 'الميزانية']
]);

export function requestGaps(criteria = {}) {
  const value = { ...criteria, district: criteria.district || uniqueDistricts(criteria.districts || [])[0] || '' };
  return REQUEST_REQUIRED.filter(([key]) => key === 'price' ? !(Number(value.price) > 0) : !String(value[key] || '').trim()).map(([key, label]) => ({ key, label }));
}

/** Why a result was shown, from what really matched — never a made-up percentage. */
export function browseReasons(criteria = {}, row = {}, { inDistrict = false } = {}) {
  const reasons = [];
  if (inDistrict && (criteria.districts?.length || criteria.district)) reasons.push('في الحي المطلوب');
  if (criteria.propertyType) reasons.push('نوع العقار المطلوب');
  if (criteria.purpose) reasons.push(criteria.purpose === 'PURCHASE' ? 'متاح للبيع' : 'متاح للإيجار');
  if (Number(criteria.price) > 0 || Number(criteria.priceMin) > 0) reasons.push('ضمن الميزانية المحددة');
  if (Number(criteria.rooms) > 0 && Number(row.rooms) >= Number(criteria.rooms)) reasons.push('عدد الغرف مناسب');
  if (Number(criteria.area) > 0 && Number(row.area) >= Number(criteria.area)) reasons.push('المساحة مناسبة');
  return reasons;
}

/**
 * A short public reference a guest can read out and quote to an office: «IQ-» + 6 characters, without the
 * look-alikes 0/O and 1/I/L. Taken from a hash (requests) or a stored id (offers), so it is stable on retries.
 */
const READABLE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function guestReference(seed = '') {
  // FNV-1a over the seed, written as 6 readable characters (31^6 ≈ 887 million references).
  let hash = 2166136261;
  for (const ch of String(seed || '')) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  let n = hash % (READABLE.length ** 6), out = '';
  for (let i = 0; i < 6; i += 1) { out = READABLE[n % READABLE.length] + out; n = Math.floor(n / READABLE.length); }
  return `IQ-${out}`;
}
