/**
 * Guest search scope (≤3 districts, ≤3 offices), eligibility and «أرسل طلبك للمكاتب» on the real Worker
 * routes behind the in-memory Firestore double. Isolated test data only; nothing is sent anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B } from '../scripts/qa/office-os/server.mjs';
import { GUEST_LIMITS, districtKey, guestScope, requestGaps, toggleLimited, uniqueDistricts, browseReasons, guestReference } from '../public/os/domain/guest-search-domain.js';

const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const OFFICE_C = 'office-gamma', OFFICE_D = 'office-delta';
for (const [id, name] of [[OFFICE_C, 'مكتب جاما'], [OFFICE_D, 'مكتب دلتا']]) {
  const office = { officeId: id, officeName: name, city: 'المدينة المنورة', phone: '0504444444', ownerUid: `uid-${id}`, active: true, publicSlug: id };
  h.store.seed(`offices/${id}`, office); h.store.seed(`publicOffices/${id}`, office);
}
h.store.patch(`publicOffices/${OFFICE_A}`, { city: 'المدينة المنورة' });
h.store.patch(`publicOffices/${OFFICE_B}`, { city: 'المدينة المنورة' });
const villa = (officeId, id, district, price, extra = {}) => h.store.seed(`offices/${officeId}/opportunities/${id}`, {
  officeId, opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'فيلا', city: 'المدينة المنورة', district,
  priceOrBudget: price, salePrice: price, advertiserRole: 'OWNER', contactPhone: '0551234567', contactName: 'مالك سري', notes: 'رمز البوابة 9911',
  lifecycleStatus: 'ACTIVE', publicSearchVisible: true, rooms: 5, area: 420, version: 1, ...extra
});
villa(OFFICE_A, 'durra-1', 'درة العقيق', 4800000);
villa(OFFICE_A, 'durra-2', 'دره العقيق', 4200000);
villa(OFFICE_A, 'durra-hidden', 'درة العقيق', 4100000, { publicSearchVisible: false });
villa(OFFICE_A, 'aziz-1', 'العزيزية', 3900000);
villa(OFFICE_A, 'khalid-1', 'الخالدية', 3500000);
villa(OFFICE_A, 'salam-1', 'السلام', 3000000);
villa(OFFICE_B, 'b-durra', 'درة العقيق', 4500000);
villa(OFFICE_C, 'c-durra', 'درة العقيق', 4600000);
villa(OFFICE_D, 'd-durra', 'درة العقيق', 4700000);

async function call(route, body) {
  const r = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
let n = 0;
const key = (label) => `${label}-${String(++n).padStart(4, '0')}-guest`;
const search = (patch = {}) => call('/os/public/search', { scope: 'all', mode: 'auto', requestKey: key('search'), ...patch });

test('domain: limits, district spelling, gaps and reasons never invent anything', () => {
  assert.equal(GUEST_LIMITS.districts, 3); assert.equal(GUEST_LIMITS.offices, 3);
  assert.equal(districtKey('حي درة العقيق'), districtKey('دره العقيق'));
  assert.equal(districtKey('الملقا'), districtKey('ملقا'));
  assert.deepEqual(uniqueDistricts(['درة العقيق', 'حي دره العقيق', 'العزيزية']), ['درة العقيق', 'العزيزية']);
  let pick = { list: [] };
  for (const d of ['أ', 'ب', 'ج']) pick = toggleLimited(pick.list, d, 3);
  assert.equal(pick.list.length, 3);
  const fourth = toggleLimited(pick.list, 'د', 3);
  assert.equal(fourth.blocked, true); assert.equal(fourth.list.length, 3, 'a fourth is refused, not swapped in');
  assert.equal(toggleLimited(pick.list, 'ب', 3).list.length, 2, 'removing frees a place');
  assert.equal(guestScope({ districts: ['1', '2', '3', '4'] }).ok, false);
  assert.equal(guestScope({ officeIds: ['a', 'b', 'c', 'd'] }).ok, false);
  assert.deepEqual(requestGaps({ district: 'درة العقيق' }).map((g) => g.key), ['purpose', 'propertyType', 'city', 'price']);
  assert.deepEqual(requestGaps({ purpose: 'PURCHASE', propertyType: 'فيلا', city: 'المدينة المنورة', districts: ['درة العقيق'], price: 5e6 }), []);
  assert.deepEqual(browseReasons({ district: 'درة العقيق' }, {}, { inDistrict: true }), ['في الحي المطلوب'], 'no type, purpose or budget reason when none was given');
  assert.match(guestReference('ab12cd34ef'), /^IQ-[2-9A-HJKMNP-Z]{6}$/); assert.equal(guestReference('ab12cd34ef'), guestReference('ab12cd34ef'), 'stable on retries');
});

test('three districts are searched together; a fourth is refused by the server', async () => {
  const r = await search({ criteria: { city: 'المدينة المنورة', districts: ['درة العقيق', 'العزيزية', 'الخالدية'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const districts = new Set(r.body.results.map((x) => districtKey(x.district)));
  assert.ok(districts.has(districtKey('درة العقيق')) && districts.has(districtKey('العزيزية')) && districts.has(districtKey('الخالدية')));
  assert.ok(!r.body.results.some((x) => x.district === 'السلام'), 'a fourth district is never added');
  assert.equal(r.body.mode, 'inventory', 'partial criteria filter on what was given');
  assert.equal(r.body.criteria.propertyType, '', 'no property type assumed');
  assert.equal(r.body.criteria.price, 0, 'no budget assumed');
  const four = await search({ criteria: { city: 'المدينة المنورة', districts: ['درة العقيق', 'العزيزية', 'الخالدية', 'السلام'] } });
  assert.equal(four.status, 400); assert.match(four.body.message, /ثلاثة أحياء/);
});

test('district spelling variants are one district, and unpublished offers never appear', async () => {
  const r = await search({ scope: 'office', officeId: OFFICE_A, criteria: { districts: ['حي دره العقيق'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const refs = r.body.results.map((x) => x.reference);
  assert.ok(refs.includes(`${OFFICE_A}:durra-1`) && refs.includes(`${OFFICE_A}:durra-2`));
  assert.ok(!refs.includes(`${OFFICE_A}:durra-hidden`), 'existing but unpublished is not shown');
  assert.ok(!JSON.stringify(r.body).includes('0551234567') && !JSON.stringify(r.body).includes('9911'), 'no owner data or notes');
});

test('eligibility is kept apart internally: no record vs a record that may not be shown', async () => {
  // Same engine call the WhatsApp agent makes, with its internal diagnostic hook.
  const { guestSearch } = await import('../worker/src/office-os/public-search-service.js');
  let seen = null;
  // Only the hidden offer fits «≤ 4.15M in درة العقيق»: it exists but is not eligible.
  const r = await call('/os/public/search', { scope: 'office', officeId: OFFICE_A, mode: 'auto', requestKey: key('hidden'), criteria: { districts: ['درة العقيق'], price: 4150000 } });
  assert.equal(r.status, 200); assert.equal(r.body.results.length, 0);
  assert.equal(r.body.ineligibleMatches, undefined, 'the guest never learns that a hidden record exists');
  const deps = { appError: (code, status, message) => Object.assign(Error(message), { code, status, publicMessage: message }), sha256Hex: async (s) => (await import('node:crypto')).createHash('sha256').update(s).digest('hex') };
  const store = { list: async (p) => h.store.list(p.join('/')).map((d) => ({ ...d })), get: async (p) => h.store.get(p.join('/')), create: async () => true, set: async () => {}, update: async () => null };
  await guestSearch({ store, deps, env: h.env, now: () => new Date(), onInventoryDiagnostic: (d) => { seen = d; } }, { input: { scope: 'office', officeId: OFFICE_A, mode: 'auto', requestKey: key('diag'), criteria: { districts: ['درة العقيق'], price: 4150000 } }, ip: 'diag' });
  assert.equal(seen.eligibleMatches, 0);
  assert.equal(seen.ineligibleMatches, 1, 'one matching record exists but is not published');
  assert.ok(seen.exclusions.not_published >= 1);
});

test('up to three chosen offices are searched; others are never read and a fourth is refused', async () => {
  const r = await search({ scope: 'selected', officeIds: [OFFICE_A, OFFICE_B, OFFICE_C], criteria: { city: 'المدينة المنورة', districts: ['درة العقيق'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const offices = new Set(r.body.results.map((x) => x.officeId));
  assert.deepEqual([...offices].sort(), [OFFICE_A, OFFICE_B, OFFICE_C].sort());
  assert.ok(!r.body.results.some((x) => x.officeId === OFFICE_D), 'an office the guest did not choose is excluded');
  const four = await search({ scope: 'selected', officeIds: [OFFICE_A, OFFICE_B, OFFICE_C, OFFICE_D], criteria: { districts: ['درة العقيق'] } });
  assert.equal(four.status, 400); assert.match(four.body.message, /ثلاثة مكاتب/);
  assert.equal((await search({ scope: 'selected', officeIds: [], criteria: { districts: ['درة العقيق'] } })).status, 400);
  assert.equal((await search({ scope: 'selected', officeIds: ['missing-office'], criteria: { districts: ['درة العقيق'] } })).status, 404);
});

test('complete criteria rank through the central matcher; budget is respected', async () => {
  const r = await search({ scope: 'office', officeId: OFFICE_A, criteria: { purpose: 'PURCHASE', propertyType: 'فيلا', city: 'المدينة المنورة', districts: ['درة العقيق'], price: 5000000 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'match');
  assert.ok(r.body.results.length >= 2);
  assert.ok(r.body.results.every((x) => x.price <= 5000000 && x.score > 0 && x.reasons.length));
});

test('an office link that keeps search to its own offers is respected', async () => {
  h.store.patch(`publicOffices/${OFFICE_C}`, { publicSearchExpand: false });
  try {
    const wide = await search({ officeId: OFFICE_C, scope: 'all', criteria: { districts: ['درة العقيق'] } });
    assert.equal(wide.status, 400);
    const own = await search({ officeId: OFFICE_C, scope: 'office', criteria: { districts: ['درة العقيق'] } });
    assert.equal(own.status, 200); assert.ok(own.body.results.every((x) => x.officeId === OFFICE_C));
    const options = await call('/os/public/search/options', { officeId: OFFICE_C });
    assert.equal(options.body.home.allowExpand, false);
  } finally { h.store.patch(`publicOffices/${OFFICE_C}`, { publicSearchExpand: true }); }
});

test('options list participating offices without phones or settings', async () => {
  const r = await call('/os/public/search/options', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.offices.length >= 4);
  assert.ok(r.body.cities.includes('المدينة المنورة'));
  assert.ok(!JSON.stringify(r.body).includes('0504444444') && !JSON.stringify(r.body).includes('ownerUid'));
});

const fullRequest = (patch = {}) => ({
  requestKey: key('req'), officeIds: [OFFICE_A, OFFICE_B], name: 'عميل اختبار', phone: '0557001100', consentProcessing: true, consentContact: true,
  text: 'أبحث عن فيلا للبيع في درة العقيق بالمدينة المنورة بميزانية 5 ملايين ريال',
  criteria: { purpose: 'PURCHASE', propertyType: 'فيلا', city: 'المدينة المنورة', districts: ['درة العقيق', 'العزيزية'], price: 5000000 }, ...patch
});
const requestsOf = (officeId, reference) => h.store.list(`offices/${officeId}/opportunities`).filter((r) => r.publicRequestReference === reference);

test('a request reaches each chosen office bank once, with one real reference, and no other office', async () => {
  const body = fullRequest();
  const r = await call('/os/public/requests', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.reference, /^IQ-[2-9A-HJKMNP-Z]{6}$/);
  assert.deepEqual(r.body.offices.map((o) => o.officeId).sort(), [OFFICE_A, OFFICE_B].sort());
  for (const officeId of [OFFICE_A, OFFICE_B]) {
    const rows = requestsOf(officeId, r.body.reference).sort((a, b) => a.district.localeCompare(b.district));
    // One request per chosen district, so the matching engine (one district per record) matches each of them.
    assert.deepEqual(rows.map((row) => row.district).sort(), ['العزيزية', 'درة العقيق'].sort(), `one request per district in ${officeId}`);
    for (const row of rows) {
      assert.equal(row.officeId, officeId); assert.equal(row.opportunityKind, 'REQUEST'); assert.equal(row.propertyType, 'فيلا');
      assert.equal(Number(row.priceOrBudget || row.budget), 5000000);
      const other = row.district === 'العزيزية' ? 'درة العقيق' : 'العزيزية';
      assert.match(row.notes || '', new RegExp(other), 'the other chosen district stays named with the request');
      assert.equal(row.consentContact, true); assert.equal(row.publicRequestSource, 'public_search');
      assert.ok(!row.publicSearchVisible, 'a request is never published');
    }
  }
  for (const officeId of [OFFICE_C, OFFICE_D]) assert.equal(requestsOf(officeId, r.body.reference).length, 0, `nothing reaches ${officeId}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const notices = h.store.list(`offices/${OFFICE_A}/notifications`).filter((n) => String(n.body || '').includes(r.body.reference));
  assert.equal(notices.length, 1, 'one notice per office, not one per district');
  // Double tap / network retry with the same key: same reference, no second record anywhere.
  const again = await call('/os/public/requests', body);
  assert.equal(again.status, 200); assert.equal(again.body.reference, r.body.reference); assert.equal(again.body.duplicate, true);
  for (const officeId of [OFFICE_A, OFFICE_B]) assert.equal(requestsOf(officeId, r.body.reference).length, 2);
  // Concurrent duplicate taps with a fresh key still leave one record per office and district (same phone + same request).
  const key2 = key('race');
  const [x, y] = await Promise.all([call('/os/public/requests', { ...body, requestKey: key2 }), call('/os/public/requests', { ...body, requestKey: key2 })]);
  assert.equal(x.body.reference, y.body.reference);
  const active = h.store.list(`offices/${OFFICE_A}/opportunities`).filter((row) => row.opportunityKind === 'REQUEST' && row.contactPhone === '0557001100' && row.lifecycleStatus !== 'DELETED');
  assert.equal(active.length, 2, 'no duplicate request records in the office bank');
});

test('a resubmitted request with other criteria never overwrites the office record; the office is told instead', async () => {
  const first = await call('/os/public/requests', fullRequest({ phone: '0557003300', officeIds: [OFFICE_B], criteria: { purpose: 'PURCHASE', propertyType: 'فيلا', city: 'المدينة المنورة', districts: ['الخالدية'], price: 3000000 } }));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const [row] = requestsOf(OFFICE_B, first.body.reference);
  const second = await call('/os/public/requests', fullRequest({ phone: '0557003300', officeIds: [OFFICE_B], criteria: { purpose: 'PURCHASE', propertyType: 'فيلا', city: 'المدينة المنورة', districts: ['الخالدية'], price: 3600000 } }));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.offices[0].changedForReview, true);
  const after = h.store.get(`offices/${OFFICE_B}/opportunities/${row.id}`);
  assert.equal(Number(after.priceOrBudget || after.budget), 3000000, 'the existing request keeps its criteria');
  assert.equal(after.publicRequestReference, first.body.reference, 'the new reference is not attached to stale criteria');
  // Sent after the answer (waitUntil), so it may land a moment later.
  let notice;
  for (let i = 0; i < 100 && !notice; i++) { notice = h.store.list(`offices/${OFFICE_B}/notifications`).find((n) => String(n.body || '').includes(second.body.reference)); if (!notice) await new Promise((r) => setTimeout(r, 10)); }
  assert.ok(notice && /3,600,000/.test(notice.body), 'the office is told the new budget');
  // Same criteria again: simply «already with the office», nothing flagged.
  const third = await call('/os/public/requests', fullRequest({ phone: '0557003300', officeIds: [OFFICE_B], criteria: { purpose: 'PURCHASE', propertyType: 'فيلا', city: 'المدينة المنورة', districts: ['الخالدية'], price: 3000000 } }));
  assert.equal(third.body.offices[0].duplicate, true); assert.equal(third.body.offices[0].changedForReview, false);
});

test('browse mode keeps «rooms+» and «area+» minima', async () => {
  villa(OFFICE_C, 'c-small', 'الخالدية', 2000000, { rooms: 3, area: 250 });
  villa(OFFICE_C, 'c-large', 'الخالدية', 2100000, { rooms: 6, area: 500 });
  const r = await search({ scope: 'office', officeId: OFFICE_C, criteria: { districts: ['الخالدية'], rooms: 4, area: 300 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.mode, 'inventory');
  const refs = r.body.results.map((x) => x.reference);
  assert.ok(refs.includes(`${OFFICE_C}:c-large`)); assert.ok(!refs.includes(`${OFFICE_C}:c-small`), 'smaller rooms/area excluded');
});

test('a request needs explicit consent, a valid phone, chosen offices and the request criteria', async () => {
  for (const patch of [{ consentProcessing: false }, { consentContact: false }, { phone: '12345' }, { name: '' }, { officeIds: [] }, { officeIds: [OFFICE_A, OFFICE_B, OFFICE_C, OFFICE_D] }]) {
    const r = await call('/os/public/requests', fullRequest(patch));
    assert.equal(r.status, 400, JSON.stringify(patch));
  }
  const gap = await call('/os/public/requests', fullRequest({ criteria: { districts: ['درة العقيق'], city: 'المدينة المنورة' } }));
  assert.equal(gap.status, 400); assert.equal(gap.body.error, 'request_incomplete');
  assert.deepEqual(Object.keys(gap.body.details).sort(), ['price', 'propertyType', 'purpose'].sort());
  // From an office link with no office chosen, the request goes to that office only.
  const own = await call('/os/public/requests', fullRequest({ officeIds: undefined, officeId: OFFICE_C, phone: '0557002200' }));
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.deepEqual(own.body.offices.map((o) => o.officeId), [OFFICE_C]);
});
