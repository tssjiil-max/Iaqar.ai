// Guest desk in a real browser on the real Worker + in-memory Firestore (isolated test data, nothing sent).
//   node scripts/qa/office-os/guest-desk.e2e.mjs        (WIDTHS=390 narrows; OUT_DIR for screenshots)
// Covers: no login · natural-language search without invented facts · ≤3 districts / ≤3 offices in the UI ·
// office-link scope · top three eligible matches only · no results → request saved in the chosen offices ·
// double tap = one request · owner offer saved for review, never published · widths, RTL, overflow, console.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B } from './server.mjs';

const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [360, 390, 430, 768, 1440];
const OUT = process.env.OUT_DIR || '/tmp/iaqar-guest-desk';
fs.mkdirSync(OUT, { recursive: true });
const h = await startOfficeOsHarness();
const MADINAH = 'المدينة المنورة';
const OFFICE_C = 'office-gamma', OFFICE_D = 'office-delta';
for (const [id, name] of [[OFFICE_C, 'مكتب جاما العقاري'], [OFFICE_D, 'مكتب دلتا العقاري']]) {
  const office = { officeId: id, officeName: name, city: MADINAH, phone: '0504444444', ownerUid: `uid-${id}`, active: true, publicSlug: id };
  h.store.seed(`offices/${id}`, office); h.store.seed(`publicOffices/${id}`, office);
}
for (const id of [OFFICE_A, OFFICE_B]) { h.store.patch(`publicOffices/${id}`, { city: MADINAH }); h.store.patch(`offices/${id}`, { city: MADINAH }); }
const villa = (officeId, id, district, price, extra = {}) => h.store.seed(`offices/${officeId}/opportunities/${id}`, {
  officeId, opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'فيلا', city: MADINAH, district,
  priceOrBudget: price, salePrice: price, advertiserRole: 'OWNER', contactPhone: '0553331234', contactName: 'مالك لا يظهر', notes: 'رمز البوابة 7788',
  lifecycleStatus: 'ACTIVE', publicSearchVisible: true, rooms: 5, area: 420, version: 1, ...extra
});
villa(OFFICE_A, 'durra-1', 'درة العقيق', 4800000);
villa(OFFICE_A, 'durra-2', 'دره العقيق', 4200000);
villa(OFFICE_A, 'durra-3', 'درة العقيق', 4600000);
villa(OFFICE_A, 'durra-4', 'درة العقيق', 4900000);
villa(OFFICE_A, 'durra-hidden', 'درة العقيق', 4100000, { publicSearchVisible: false });
villa(OFFICE_B, 'b-durra', 'درة العقيق', 4500000);
villa(OFFICE_C, 'c-aziz', 'العزيزية', 3900000);

const browser = await chromium.launch();
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const proof = { widths: [], matches: null, request: null, offer: null, isolation: null };
async function openPage(width, url = '/?view=search') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ar-SA' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${h.origin}${url}`); await page.locator('[data-guest-desk]').waitFor();
  return { page, ctx, errors };
}
const requestRows = (officeId, reference) => h.store.list(`offices/${officeId}/opportunities`).filter((r) => r.publicRequestReference === reference);

try {
  // 1–3, 7–8: guest, natural language, top three eligible, no invented facts — at every width.
  for (const width of WIDTHS) {
    const { page, ctx, errors } = await openPage(width);
    assert.equal(await page.locator('[data-login-form]').count(), 0, 'no login');
    assert.equal(await page.locator('[name=contactPhone], [name=requestPhone]:visible').count(), 0, 'no phone before a choice');
    assert.equal(await page.locator('[data-guest-path]').count(), 3);
    assert.match(await page.locator('[data-guest-hero]').innerText(), /عقارك المناسب يبدأ من هنا/);
    assert.match(await page.locator('[data-guest-badge]').innerText(), /بحث ذكي • بدون تسجيل/);
    await page.screenshot({ path: path.join(OUT, `${width}-1-landing.png`), fullPage: true });
    await page.locator('textarea[name=description]').fill('أبحث عن فيلا للبيع في درة العقيق بالمدينة المنورة بميزانية 5 ملايين ريال.');
    await page.locator('[data-guest-search]').click();
    await page.locator('[data-search-result]').first().waitFor();
    assert.equal(await page.locator('[name=propertyType]').inputValue(), 'فيلا');
    assert.equal(await page.locator('[name=price]').inputValue(), '5000000');
    assert.equal(await page.locator('[name=district]').inputValue(), 'درة العقيق');
    assert.equal(await page.locator('[name=rooms]').inputValue(), '', 'rooms not invented');
    assert.equal(await page.locator('[name=area]').inputValue(), '', 'area not invented');
    assert.equal(await page.locator('[data-search-result]').count(), 3, 'best three first');
    const refs = await page.locator('[data-search-result]').evaluateAll((n) => n.map((x) => x.dataset.searchResult));
    assert.ok(!refs.some((r) => r.includes('hidden')), 'unpublished never shown');
    const text = await page.locator('[data-guest-results]').innerText();
    assert.ok(!text.includes('0553331234') && !text.includes('7788') && !text.includes('مالك لا يظهر'), 'no owner data');
    assert.match(text, /سبب الترشيح/);
    await page.locator('[data-more-results]').waitFor();
    if (width === 390) proof.matches = { shown: refs, hiddenExcluded: `${OFFICE_A}:durra-hidden` };
    await page.screenshot({ path: path.join(OUT, `${width}-2-results.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.ok(await noOverflow(page), `no horizontal scroll at ${width}`);
    // The first action button is never under a fixed bar: public pages have none.
    assert.equal(await page.locator('.ref-bottom').count(), 0);
    assert.deepEqual(errors, [], `console clean at ${width}`);
    proof.widths.push({ width, overflow: false, consoleErrors: 0, results: refs.length });
    await ctx.close();
    console.log(`✔ ${width}px search → top three eligible`);
  }

  // 4–5: three districts and three offices; a fourth is refused in the UI.
  {
    const { page, ctx, errors } = await openPage(390);
    await page.locator('[data-search-criteria] > summary').click();
    const q = page.locator('[name=districtsQuery]');
    for (const d of ['درة العقيق', 'العزيزية', 'الخالدية']) { await q.fill(d); await page.locator(`[data-picker=districts] [data-pick-option="${d}"], [data-pick-free=districts]`).first().click(); await q.fill(''); }
    assert.equal(await page.locator('[data-picked=districts] [data-chip]').count(), 3);
    await q.fill('السلام'); await page.locator('[data-picker=districts] [data-pick-option="السلام"]').click();
    assert.equal(await page.locator('[data-picked=districts] [data-chip]').count(), 3, 'fourth district refused');
    assert.equal(await page.locator('[data-pick-limit=districts]').isVisible(), true);
    assert.equal(await page.locator('[data-pick-count=districts]').innerText(), '3 من 3');
    for (const id of [OFFICE_A, OFFICE_B, OFFICE_C]) await page.locator(`[data-picker=offices] [data-pick-option="${id}"]`).click();
    await page.locator(`[data-picker=offices] [data-pick-option="${OFFICE_D}"]`).click();
    assert.equal(await page.locator('[data-picked=offices] [data-chip]').count(), 3, 'fourth office refused');
    assert.equal(await page.locator('[name=scope]').inputValue(), 'selected');
    await page.screenshot({ path: path.join(OUT, '390-3-scope-limits.png'), fullPage: true });
    await page.locator('[data-guest-search]').click();
    await page.locator('[data-search-result]').first().waitFor();
    const offices = await page.locator('[data-search-result]').evaluateAll((n) => [...new Set(n.map((x) => x.dataset.searchResult.split(':')[0]))]);
    assert.ok(offices.every((o) => [OFFICE_A, OFFICE_B, OFFICE_C].includes(o)), 'only chosen offices');
    proof.isolation = { chosen: [OFFICE_A, OFFICE_B, OFFICE_C], resultOffices: offices, excluded: OFFICE_D };
    assert.ok(await noOverflow(page)); assert.deepEqual(errors, []);
    await ctx.close();
    console.log('✔ ≤3 districts and ≤3 offices enforced; results only from chosen offices');
  }

  // 6: office link = that office's offers; «اعرض عقارك» is the office's own owner form.
  {
    const { page, ctx, errors } = await openPage(390, '/m/sultan');
    assert.equal(await page.locator('[name=scope]').inputValue(), 'office');
    await page.locator('textarea[name=description]').fill('وش عندك عروض في درة العقيق؟');
    await page.locator('[data-guest-search]').click();
    await page.locator('[data-search-result]').first().waitFor();
    const refs = await page.locator('[data-search-result]').evaluateAll((n) => n.map((x) => x.dataset.searchResult));
    assert.ok(refs.every((r) => r.startsWith(`${OFFICE_A}:`)), 'office link stays in its office');
    assert.equal(await page.locator('[name=propertyType]').inputValue(), '', 'inventory enquiry: no type assumed');
    assert.equal(await page.locator('[name=price]').inputValue(), '', 'inventory enquiry: no budget assumed');
    await page.screenshot({ path: path.join(OUT, '390-4-office-link.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
    console.log('✔ office link: «وش عندك عروض في درة العقيق؟» → this office only, nothing assumed');
  }

  // Review fixes: Arabic-Indic budget digits are read; a restricted office link always keeps its office.
  {
    const { page, ctx, errors } = await openPage(390);
    await page.locator('[data-search-criteria] > summary').click();
    await page.locator('[name=districtsQuery]').fill('درة العقيق');
    await page.locator('[data-pick-free=districts], [data-picker=districts] [data-pick-option="درة العقيق"]').first().click();
    await page.locator('[data-guest-specs] > summary').click();
    await page.locator('[name=price]').fill('٤٫٧٠٠٫٠٠٠'.replace(/٫/g, ''));
    await page.locator('[data-guest-search]').click();
    await page.locator('[data-search-result]').first().waitFor();
    const prices = await page.locator('[data-search-result] .os-guest-price').allInnerTexts();
    assert.ok(prices.every((p) => Number(p.replace(/\D/g, '')) <= 4700000), `Arabic-Indic budget applied: ${prices}`);
    assert.match(await page.locator('[data-search-summary]').innerText(), /4,700,000/);
    assert.deepEqual(errors, []);
    await ctx.close();
    h.store.patch(`publicOffices/${OFFICE_A}`, { publicSearchExpand: false });
    const slow = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-SA' });
    const p2 = await slow.newPage();
    // Hold the office list so the guest can clear the office before it arrives.
    let release; const held = new Promise((r) => { release = r; });
    await p2.route('**/os/public/search/options', async (route) => { await held; await route.continue(); });
    await p2.goto(`${h.origin}/m/sultan`); await p2.locator('[data-guest-desk]').waitFor();
    await p2.locator('[data-search-criteria] > summary').click();
    await p2.locator('[data-pick-all=offices]').click();
    assert.equal(await p2.locator('[data-picked=offices] [data-chip]').count(), 0);
    release();
    await p2.locator('[data-scope-note]:not([hidden])').waitFor();
    assert.equal(await p2.locator('[data-picked=offices] [data-chip]').count(), 1, 'the link office is restored');
    assert.equal(await p2.locator('[name=scope]').inputValue(), 'office');
    await slow.close();
    h.store.patch(`publicOffices/${OFFICE_A}`, { publicSearchExpand: true });
    console.log('✔ Arabic-Indic budget read; restricted link keeps its office');
  }

  // 9–11, 17–18: no results → send to the chosen offices, saved in each office bank; double tap = one request; error then retry.
  {
    const { page, ctx, errors } = await openPage(390);
    await page.locator('textarea[name=description]').fill('أبحث عن شقة للإيجار في حي الهجرة بالمدينة المنورة بميزانية 40 ألف ريال');
    await page.locator('[data-guest-search]').click();
    await page.locator('[data-no-results]').waitFor();
    assert.match(await page.locator('[data-no-results]').innerText(), /ما لقينا المناسب حاليًا، خلّ المكاتب تبحث لك/);
    await page.screenshot({ path: path.join(OUT, '390-5-no-results.png'), fullPage: true });
    await page.locator('[data-no-results] [data-send-office-request]').click();
    await page.locator('[data-guest-panel=request]').waitFor();
    assert.equal(await page.locator('[name=district]').inputValue(), 'الهجرة', 'criteria kept');
    // Error state first: no office chosen yet.
    await page.locator('[name=requestName]').fill('عميل الطلب');
    await page.locator('[name=requestPhone]').fill('0557000555');
    await page.locator('[name=requestConsentProcessing]').check(); await page.locator('[name=requestConsentContact]').check();
    await page.locator('[data-guest-request-submit]').click();
    assert.match(await page.locator('[data-guest-request-form] .os-alert.bad').innerText(), /اختر مكتبًا/);
    for (const id of [OFFICE_C, OFFICE_D]) await page.locator(`[data-picker=offices] [data-pick-option="${id}"]`).click();
    await page.screenshot({ path: path.join(OUT, '390-6-request-form.png'), fullPage: true });
    // Double tap: both clicks land before the answer; one reference, one record per office.
    await page.locator('[data-guest-request-submit]').dblclick();
    await page.locator('[data-request-reference]').waitFor();
    const reference = await page.locator('[data-request-reference]').getAttribute('data-request-reference');
    assert.match(reference, /^IQ-[A-F0-9]{8}$/);
    for (const id of [OFFICE_C, OFFICE_D]) {
      const rows = requestRows(id, reference);
      assert.equal(rows.length, 1, `exactly one request in ${id}`);
      assert.equal(rows[0].opportunityKind, 'REQUEST'); assert.equal(rows[0].officeId, id); assert.equal(rows[0].district, 'الهجرة');
      assert.equal(rows[0].purpose, 'LEASE_REQUEST'); assert.equal(Number(rows[0].priceOrBudget || rows[0].budget), 40000);
    }
    for (const id of [OFFICE_A, OFFICE_B]) assert.equal(requestRows(id, reference).length, 0, `nothing in ${id}`);
    proof.request = { reference, savedIn: [OFFICE_C, OFFICE_D], notIn: [OFFICE_A, OFFICE_B], recordIds: [OFFICE_C, OFFICE_D].map((id) => `${id}/${requestRows(id, reference)[0].id}`) };
    await page.screenshot({ path: path.join(OUT, '390-7-request-sent.png'), fullPage: true });
    assert.ok(await noOverflow(page)); assert.deepEqual(errors.filter((e) => !/400/.test(e)), []);
    await ctx.close();
    console.log(`✔ request ${reference} saved once in each chosen office bank, none elsewhere`);
  }

  // 12: owner offer from the platform page → the chosen office, for review, never published.
  {
    const { page, ctx, errors } = await openPage(390);
    await page.locator('[data-guest-path=offer]').click();
    await page.locator(`[data-picker=offerOffice] [data-pick-option="${OFFICE_B}"]`).click();
    await page.locator('[data-offer-continue]').click();
    await page.locator('[data-offer-form-host] [data-fill-mode="manual"]').click();
    const form = page.locator('[data-offer-form-host]');
    await form.locator('.os-seg button', { hasText: 'بيع' }).first().click();
    await form.locator('[name=propertyType]').fill('فيلا');
    await form.locator('[name=city]').fill(MADINAH);
    await form.locator('[name=district]').fill('درة العقيق');
    await form.locator('[name=price]').fill('4700000');
    await form.locator('[name=contactName]').fill('مالك تجريبي');
    await form.locator('[name=contactPhone]').fill('0557000666');
    await form.locator('[name=consentProcessing]').check();
    await page.screenshot({ path: path.join(OUT, '390-8-offer-form.png'), fullPage: true });
    await form.getByRole('button', { name: 'إرسال', exact: true }).click();
    await page.locator('[data-intake-reference]').waitFor();
    const ref = (await page.locator('[data-intake-reference]').innerText()).split(': ').at(-1);
    const saved = h.store.get(`offices/${OFFICE_B}/opportunities/opp_intake_${ref}`);
    assert.ok(saved, 'offer reaches the chosen office');
    assert.equal(saved.opportunityKind, 'OFFER'); assert.equal(saved.officeId, OFFICE_B);
    assert.notEqual(saved.publicSearchVisible, true, 'never published automatically');
    for (const id of [OFFICE_A, OFFICE_C, OFFICE_D]) assert.equal(h.store.get(`offices/${id}/opportunities/opp_intake_${ref}`), null, `not in ${id}`);
    proof.offer = { reference: ref, office: OFFICE_B, record: `offices/${OFFICE_B}/opportunities/opp_intake_${ref}`, publicSearchVisible: saved.publicSearchVisible ?? false, workflowStage: saved.workflowStage };
    await page.screenshot({ path: path.join(OUT, '390-9-offer-sent.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
    console.log(`✔ owner offer ${ref} saved for review in ${OFFICE_B}, not published`);
  }
  fs.writeFileSync(path.join(OUT, 'guest-desk-proof.json'), JSON.stringify(proof, null, 2));
  console.log(`Guest desk: ${WIDTHS.length} widths + scope limits + office link + request + offer passed.`);
} finally { await browser.close(); h.server.close(); }
