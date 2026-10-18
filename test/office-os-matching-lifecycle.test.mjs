/**
 * The real journey of one offer and one request, end to end on the Worker routes (in-memory Firestore, isolated
 * QA offices, nothing sent): owner offer → office bank (awaiting review) → published by the manager → found by
 * the guest search → matched to the request inside the office → unpublished → gone from the guest search.
 *
 *   Offer:   عمارة للبيع في درة العقيق، المدينة المنورة، 3,000,000 ريال، 650 م²
 *   Request: عمارة للبيع في درة العقيق، المدينة المنورة، 2,500,000 – 3,500,000 ريال، 500 م² على الأقل
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B, OWNER_A, idTokenFor } from '../scripts/qa/office-os/server.mjs';
import { extractFacts, mergeDraft, toRecordInput } from '../public/os/domain/visitor-domain.js';
import { inventoryInquiry } from '../public/os/domain/inventory-query-domain.js';
import { priceRangeFrom, priceRangeLabel } from '../public/os/domain/price-range-domain.js';
import { analyzeText } from '../public/os/domain/smart-fill-domain.js';

const MADINAH = 'المدينة المنورة';
const REQUEST_TEXT = 'أبحث عن عمارة للبيع في درة العقيق أو الأحياء القريبة بالمدينة المنورة بميزانية من 2,500,000 إلى 3,500,000 ريال ومساحة لا تقل عن 500 متر';
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
for (const id of [OFFICE_A, OFFICE_B]) { h.store.patch(`publicOffices/${id}`, { city: MADINAH }); h.store.patch(`offices/${id}`, { city: MADINAH }); }

async function call(route, body, uid = '') {
  const r = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${idTokenFor(uid)}` } : {}) }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
let n = 0;
const key = (label) => `${label}-${String(++n).padStart(4, '0')}-lifecycle-qa`;
const intakeId = 'qalifecycle000000001';
const offerId = `opp_intake_${intakeId}`;
const offerPath = `offices/${OFFICE_A}/opportunities/${offerId}`;
let criteria = null;
const search = (patch = {}) => call('/os/public/search', { officeId: OFFICE_A, scope: 'office', mode: 'auto', requestKey: key('s'), criteria, ...patch });
const refs = (r) => (r.body.results || []).map((x) => x.reference);

test('the request text is understood exactly: both budget bounds, the area, one district, nothing invented', async () => {
  assert.deepEqual(priceRangeFrom(REQUEST_TEXT), { min: 2_500_000, max: 3_500_000 });
  const local = analyzeText(REQUEST_TEXT).listings[0];
  const r = await call('/os/public/search/analyze', { officeId: OFFICE_A, text: REQUEST_TEXT });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const l = r.body.listings[0];
  for (const listing of [local, l]) {
    assert.equal(listing.priceMin, 2_500_000, 'the lower bound stays the lower bound');
    assert.equal(listing.price, 3_500_000, 'the budget is the upper bound');
    assert.equal(listing.area, 500);
    assert.deepEqual(listing.districts, ['درة العقيق'], '«الأحياء القريبة» is a wish, not a district named «القريبة»');
    assert.equal(listing.nearby, true);
    assert.ok(!listing.districts.includes('طيبة') && !listing.districts.includes('القريبة'));
  }
  assert.equal(priceRangeLabel({ min: l.priceMin, max: l.price }), 'من 2,500,000 إلى 3,500,000 ريال');
  criteria = { purpose: 'PURCHASE', propertyType: l.propertyType, city: l.city, districts: l.districts, priceMin: l.priceMin, price: l.price, area: l.area };
  assert.deepEqual(criteria, { purpose: 'PURCHASE', propertyType: 'عمارة', city: MADINAH, districts: ['درة العقيق'], priceMin: 2_500_000, price: 3_500_000, area: 500 });
});

test('1. an owner offer awaiting the office review is in the bank but never in the guest search', async () => {
  h.store.seed(`offices/${OFFICE_A}/publicIntake/${intakeId}`, { officeId: OFFICE_A, kind: 'owner', submitterRole: 'OWNER', name: 'مالك اختبار', phone: '0557111222', propertyType: 'عمارة', district: 'درة العقيق', city: MADINAH, purpose: 'SALE', transactionType: 'sale', amount: 3_000_000, area: 650, rooms: 0, details: '', mediaPaths: [], imageCount: 0, hasVideo: false, source: 'office_public_link', fillMethod: 'MANUAL', submitterCapacity: 'OWNER', consentProcessing: true, status: 'new', createdAt: new Date().toISOString() });
  const intake = await call('/pipeline/public-intake', { officeId: OFFICE_A, intakeId });
  assert.ok(intake.status === 200 || intake.status === 201, JSON.stringify(intake.body));
  const offer = h.store.get(offerPath);
  assert.equal(offer.opportunityKind, 'OFFER'); assert.equal(offer.salePrice, 3_000_000); assert.equal(offer.area, 650);
  assert.notEqual(offer.publicSearchVisible, true, 'awaiting review: not published');
  assert.match(offer.publicReference, /^IQ-[2-9A-HJKMNP-Z]{6}$/, 'the short reference the owner was shown is on the record');
  const r = await search();
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(refs(r), []);
});

test('2. once the manager publishes it, the guest search finds it at once — no request needed first', async () => {
  const pub = await call('/os/records/save', { officeId: OFFICE_A, recordId: offerId, requestKey: key('pub'), record: { kind: 'OFFER', purpose: 'SALE', propertyType: 'عمارة', city: MADINAH, district: 'درة العقيق', price: 3_000_000, area: 650, contactPhone: '0557111222', contactName: 'مالك اختبار', publicSearchVisible: true } }, OWNER_A);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const r = await search();
  assert.deepEqual(refs(r), [`${OFFICE_A}:${offerId}`]);
  assert.equal(r.body.mode, 'match', 'complete criteria rank through the central matcher');
  assert.ok(r.body.results[0].reasons.length);
  // The lower bound is applied: a 2,000,000 building in the same district is not shown for a 2.5M–3.5M request.
  h.store.seed(`offices/${OFFICE_A}/opportunities/qa-cheap`, { officeId: OFFICE_A, opportunityKind: 'OFFER', purpose: 'SALE', propertyType: 'عمارة', city: MADINAH, district: 'درة العقيق', priceOrBudget: 2_000_000, salePrice: 2_000_000, area: 700, lifecycleStatus: 'ACTIVE', publicSearchVisible: true });
  h.store.seed(`offices/${OFFICE_A}/opportunities/qa-small`, { officeId: OFFICE_A, opportunityKind: 'OFFER', purpose: 'SALE', propertyType: 'عمارة', city: MADINAH, district: 'درة العقيق', priceOrBudget: 2_900_000, salePrice: 2_900_000, area: 400, lifecycleStatus: 'ACTIVE', publicSearchVisible: true });
  const strict = await search();
  assert.deepEqual(refs(strict), [`${OFFICE_A}:${offerId}`], 'below the minimum budget or the minimum area: not shown');
});

let request = null;
test('3. the request reaches the office request bank with both bounds, a short reference and its real status', async () => {
  const r = await call('/os/public/requests', { officeId: OFFICE_A, officeIds: [OFFICE_A], requestKey: key('req'), criteria, text: REQUEST_TEXT, name: 'عميل الاختبار', phone: '0557222333', consentProcessing: true, consentContact: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.reference, /^IQ-[2-9A-HJKMNP-Z]{6}$/);
  assert.deepEqual(r.body.offices.map((o) => [o.officeId, o.status, o.notified]), [[OFFICE_A, 'SAVED_AWAITING_OFFICE', true]]);
  const rows = h.store.list(`offices/${OFFICE_A}/opportunities`).filter((row) => row.publicRequestReference === r.body.reference);
  assert.equal(rows.length, 1);
  request = rows[0];
  assert.equal(request.opportunityKind, 'REQUEST'); assert.equal(request.priceMin, 2_500_000); assert.equal(request.priceMax, 3_500_000); assert.equal(request.area, 500);
  assert.equal(h.store.list(`offices/${OFFICE_B}/opportunities`).filter((row) => row.publicRequestReference === r.body.reference).length, 0, 'no other office');
  const notice = h.store.list(`offices/${OFFICE_A}/notifications`).find((x) => String(x.body || '').includes(r.body.reference));
  assert.ok(notice && /من 2,500,000 إلى 3,500,000 ريال/.test(notice.body), 'the office is told the real range');
  // Resubmitting the same request (same key or a new one) never adds records.
  const again = await call('/os/public/requests', { officeId: OFFICE_A, officeIds: [OFFICE_A], requestKey: key('req'), criteria, text: REQUEST_TEXT, name: 'عميل الاختبار', phone: '0557222333', consentProcessing: true, consentContact: true });
  assert.equal(again.status, 200); assert.equal(again.body.offices[0].duplicate, true);
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).filter((row) => row.opportunityKind === 'REQUEST' && row.contactPhone === '0557222333' && row.lifecycleStatus !== 'DELETED').length, 1);
});

test('4. inside the office the central matcher pairs the request with the published offer (office permissions)', async () => {
  const c = await call('/os/records/candidates', { officeId: OFFICE_A, recordId: request.id }, OWNER_A);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const ids = c.body.candidates.map((x) => x.recordId);
  assert.ok(ids.includes(offerId), `offer among the office candidates: ${ids}`);
  assert.ok(!ids.includes('qa-cheap'), '2,000,000 is outside the 2.5M–3.5M range for the central matcher too');
  // Another office cannot read this office's candidates.
  assert.equal((await call('/os/records/candidates', { officeId: OFFICE_A, recordId: request.id }, 'uid-owner-b')).status, 403);
});

test('6. the same criteria from the page, the office link, the inventory enquiry and the WhatsApp agent give the same offer', async () => {
  const page = await call('/os/public/search', { scope: 'all', mode: 'auto', requestKey: key('pg'), criteria });
  const link = await search();
  const enquiry = inventoryInquiry('وش عندك عمائر في درة العقيق من 2.5 إلى 3.5 مليون؟');
  assert.deepEqual(enquiry, { propertyType: 'عمارة', district: 'درة العقيق', price: 3_500_000, priceMin: 2_500_000 });
  const inventory = await call('/os/public/search', { officeId: OFFICE_A, scope: 'office', mode: 'inventory', requestKey: key('inv'), criteria: enquiry });
  // The WhatsApp agent builds its search from its own reader of the same words, then calls the same engine.
  const draft = mergeDraft({ kind: 'REQUEST' }, extractFacts(REQUEST_TEXT));
  assert.equal(draft.price, 3_500_000); assert.equal(draft.priceMin, 2_500_000);
  const wa = await call('/os/public/search', { officeId: OFFICE_A, scope: 'office', requestKey: key('wa'), criteria: { ...toRecordInput({ ...draft, district: 'درة العقيق' }, { phone: '0557222333', name: 'عميل واتساب' }) } });
  for (const r of [page, link, inventory, wa]) assert.equal(r.status, 200, JSON.stringify(r.body));
  // Same criteria → the same answer, in the same order.
  for (const r of [page, link, wa]) assert.deepEqual(refs(r), [`${OFFICE_A}:${offerId}`]);
  // The short question names no area, so a smaller building in budget fits it too — never one outside the range.
  assert.ok(refs(inventory).includes(`${OFFICE_A}:${offerId}`));
  assert.ok(inventory.body.results.every((x) => x.price >= 2_500_000 && x.price <= 3_500_000));
  // Repeating the search gives the same answer.
  assert.deepEqual(refs(await search()), refs(await search()));
});

test('5. after the manager unpublishes it, it leaves the guest search; the office still has it', async () => {
  const off = await call('/os/records/save', { officeId: OFFICE_A, recordId: offerId, requestKey: key('unpub'), record: { kind: 'OFFER', purpose: 'SALE', propertyType: 'عمارة', city: MADINAH, district: 'درة العقيق', price: 3_000_000, area: 650, contactPhone: '0557111222', contactName: 'مالك اختبار', publicSearchVisible: false } }, OWNER_A);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.deepEqual(refs(await search()), []);
  assert.ok(h.store.get(offerPath), 'kept in the office bank');
  const c = await call('/os/records/candidates', { officeId: OFFICE_A, recordId: request.id }, OWNER_A);
  assert.ok(c.body.candidates.some((x) => x.recordId === offerId), 'the office may still match its own unpublished offer');
});
