import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A } from '../scripts/qa/office-os/server.mjs';
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const base = { officeId: OFFICE_A, opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'شقة', city: 'الرياض', district: 'الملقا', priceOrBudget: 500000, salePrice: 500000, advertiserRole: 'OWNER', contactPhone: '0551234567', lifecycleStatus: 'ACTIVE', version: 1 };
h.store.seed(`offices/${OFFICE_A}/opportunities/search-request`, { ...base, opportunityKind: 'REQUEST', purpose: 'PURCHASE', advertiserRole: 'CLIENT', budget: 550000, priceOrBudget: 550000 });
for (let i = 0; i < 14; i++) h.store.seed(`offices/${OFFICE_A}/opportunities/search-offer-${i}`, { ...base, propertyId: `property-${Math.floor(i / 2)}` });
async function call(body, authenticated = true) {
  const response = await h.worker.fetch(new Request('https://worker.test/os/records/candidates', { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${idTokenFor(OWNER_A)}` } : {}) }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
test('internal search runs through the central orchestrator and returns unique office-scoped references', async () => {
  const r = await call({ officeId: OFFICE_A, recordId: 'search-request', limit: 20 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.orchestration.event, 'SEARCH_REQUESTED');
  assert.equal(r.body.orchestration.trace[0].target, 'matching-engine');
  assert.equal(r.body.candidates.length, 7);
  assert.ok(r.body.candidates.every(row => row.officeId === OFFICE_A && row.reference === `${OFFICE_A}:${row.recordId}`));
  assert.equal(new Set(r.body.candidates.map(row => row.propertyId)).size, 7);
  assert.equal(r.body.messagesSent, 0);
});
test('search never exceeds ten real results', async () => {
  for (let i = 0; i < 14; i++) h.store.seed(`offices/${OFFICE_A}/opportunities/unique-${i}`, { ...base, propertyId: `unique-property-${i}` });
  const r = await call({ officeId: OFFICE_A, recordId: 'search-request', limit: 999 });
  assert.equal(r.status, 200);
  assert.equal(r.body.candidates.length, 10);
});
test('membership is required before central search reads office data', async () => {
  assert.ok([401, 403].includes((await call({ officeId: OFFICE_A, recordId: 'search-request' }, false)).status));
  assert.equal((await call({ officeId: OFFICE_B, recordId: 'opp_b_offer' })).status, 403);
});
test('search failure never becomes a successful empty result', async () => {
  const r = await call({ officeId: OFFICE_A, recordId: 'missing-record' });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});
