import test from 'node:test';
import assert from 'node:assert/strict';
import { priceRangeFrom, priceRangeLabel } from '../public/os/domain/price-range-domain.js';
import { analyzeText, districtsFrom, acceptsNearby } from '../public/os/domain/smart-fill-domain.js';
import { extractFacts, mergeDraft, summaryLines } from '../public/os/domain/visitor-domain.js';
import { inventoryInquiry } from '../public/os/domain/inventory-query-domain.js';
import { validateRecordInput, recordFields } from '../public/os/domain/records-domain.js';

test('budget ranges keep both bounds, in every way they are written', () => {
  const cases = {
    'بميزانية من 2,500,000 إلى 3,500,000 ريال': [2_500_000, 3_500_000],
    'الميزانية من 2.5 مليون إلى 3.5 مليون': [2_500_000, 3_500_000],
    'بين 2500000 و 3500000 ريال': [2_500_000, 3_500_000],
    'السعر 2.5 - 3.5 مليون': [2_500_000, 3_500_000],
    'من مليونين ونص إلى 3 ملايين': [2_500_000, 3_000_000],
    'بميزانية ٢٫٥ إلى ٣٫٥ مليون': [2_500_000, 3_500_000],
    'من 500 الف الى 700 الف': [500_000, 700_000],
    'من 3,500,000 إلى 2,500,000 ريال': [2_500_000, 3_500_000]
  };
  for (const [text, [min, max]] of Object.entries(cases)) assert.deepEqual(priceRangeFrom(text), { min, max }, text);
  assert.deepEqual(priceRangeFrom('بميزانية لا تزيد عن 3 ملايين'), { min: 0, max: 3_000_000 });
  assert.deepEqual(priceRangeFrom('بميزانية لا تقل عن مليون'), { min: 1_000_000, max: 0 });
});

test('areas, rooms, floors and phone numbers are never read as a budget range', () => {
  for (const text of ['مساحة من 500 إلى 700 متر', 'شقة من 3 الى 4 غرف ميزانية مليون', 'في الدور 2 الى 3 ب 900 الف', 'جوالي 0551234567', 'بسعر 3 مليون']) assert.equal(priceRangeFrom(text), null, text);
});

test('range labels say exactly what was asked', () => {
  assert.equal(priceRangeLabel({ min: 2_500_000, max: 3_500_000 }), 'من 2,500,000 إلى 3,500,000 ريال');
  assert.equal(priceRangeLabel({ max: 3_000_000 }), 'حتى 3,000,000 ريال');
  assert.equal(priceRangeLabel({ min: 1_000_000 }), 'من 1,000,000 ريال فأكثر');
  assert.equal(priceRangeLabel({}), '');
});

test('«الأحياء القريبة» and other descriptions are never districts', () => {
  for (const text of ['عمارة في درة العقيق أو الأحياء القريبة', 'عمارة في درة العقيق والأحياء المجاورة', 'في درة العقيق والأحياء المحيطة', 'في درة العقيق أو الأحياء الأخرى']) {
    assert.deepEqual(districtsFrom(text), ['درة العقيق'], text);
  }
  assert.equal(acceptsNearby('في درة العقيق أو الأحياء القريبة'), true);
  assert.equal(acceptsNearby('في درة العقيق والملقا'), false);
  assert.deepEqual(districtsFrom('في الملقا أو النرجس'), ['الملقا', 'النرجس'], 'real lists still work');
});

test('the office smart fill, the WhatsApp reader and the short enquiry agree on the same request', () => {
  const text = 'أبحث عن عمارة للبيع في درة العقيق بالمدينة المنورة بميزانية من 2,500,000 إلى 3,500,000 ريال ومساحة لا تقل عن 500 متر';
  const page = analyzeText(text).listings[0];
  const wa = mergeDraft({ kind: 'REQUEST' }, extractFacts(text));
  assert.deepEqual([page.priceMin, page.price, page.area], [2_500_000, 3_500_000, 500]);
  assert.deepEqual([wa.priceMin, wa.price, wa.area], [2_500_000, 3_500_000, 500]);
  assert.ok(summaryLines(wa).some((l) => l.includes('من 2,500,000 إلى 3,500,000')), 'the agent repeats the range');
  assert.deepEqual(inventoryInquiry('وش عندك عمائر في درة العقيق من 2.5 إلى 3.5 مليون؟'), { propertyType: 'عمارة', district: 'درة العقيق', price: 3_500_000, priceMin: 2_500_000 });
  assert.equal(analyzeText('عندي عمارة للبيع في درة العقيق بسعر 3 مليون').listings[0].priceMin, 0, 'an offer has one price');
});

test('a request record stores both bounds for the central matcher; a wrong order is refused', () => {
  const base = { kind: 'REQUEST', purpose: 'PURCHASE', propertyType: 'عمارة', city: 'المدينة المنورة', district: 'درة العقيق', price: 3_500_000, contactPhone: '0557000000' };
  const ok = validateRecordInput({ ...base, priceMin: 2_500_000 });
  assert.equal(ok.ok, true);
  const fields = recordFields(ok.value, { officeId: 'o1', brokerId: 'b1' });
  assert.equal(fields.priceMin, 2_500_000); assert.equal(fields.priceMax, 3_500_000);
  assert.equal(validateRecordInput({ ...base, priceMin: 4_000_000 }).ok, false);
  const offer = validateRecordInput({ ...base, kind: 'OFFER', purpose: 'SALE', priceMin: 2_500_000 });
  assert.equal(recordFields(offer.value, { officeId: 'o1', brokerId: 'b1' }).priceMin, null, 'offers have no lower bound');
});
