// Guest journeys on the office link in a real browser, at phone and desktop widths:
//   search: write → «ابحث عن العقارات الآن» → the closest three, more on request → choose → consent → WhatsApp handoff;
//   «أرسل طلبي للمكتب العقاري»: wrong phone refused → saved once → the office's own request (also with no results);
//   scope: this office ↔ all published offers; «لدي عقار وأريد عرضه»: saved for review, never public by itself.
// Nothing is sent: no WhatsApp message and no paid AI call leaves this process.
//   node scripts/qa/office-os/public-search.e2e.mjs      (WIDTHS=390 narrows; OUT_DIR for screenshots; CHROME for a local browser)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B } from './server.mjs';
import { resetPublicRateLimitStoreForTests } from '../../../worker/src/public-rate-limit.js';
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [320, 360, 390, 430, 768, 1024, 1440];
const OUT = process.env.OUT_DIR || '/tmp/iaqar-public-search';
fs.mkdirSync(OUT, { recursive: true });
// Anything leaving this process for Meta or a paid model would be a real message or a real charge.
const external = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => { const u = String(url?.url || url); if (/graph\.facebook\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.openai\.com/.test(u)) external.push(u); return realFetch(url, init); };
const h = await startOfficeOsHarness();
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const offer = { officeId: OFFICE_A, opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'شقة', city: 'الرياض', district: 'الملقا', priceOrBudget: 500000, salePrice: 500000, advertiserRole: 'OWNER', contactPhone: '0553331234', contactName: 'مالك لا يظهر', lifecycleStatus: 'ACTIVE', publicSearchVisible: true, rooms: 4, version: 1 };
const SEARCH = 'مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف';
const NOTHING = 'أبحث عن فيلا تمليك في حي العقيق بالرياض بحدود مليونين ريال';
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const intakesOf = (officeId) => h.store.list(`offices/${officeId}/publicIntake`);
const opportunitiesOf = (officeId) => h.store.list(`offices/${officeId}/opportunities`);
async function open(width) {
 const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ar-SA' });
 const page = await ctx.newPage(); const errors = [], selectApi = [];
 page.on('pageerror', (e) => errors.push(e.message));
 page.on('request', (request) => { if (new URL(request.url()).pathname === '/os/public/search/select') selectApi.push({ request: request.postData() }); });
 page.on('response', async (response) => { if (new URL(response.url()).pathname === '/os/public/search/select') selectApi.push({ status: response.status(), body: await response.text().catch(() => '') }); });
 // A WhatsApp link is the client's own app: the page must never call it by itself.
 const whatsapp = []; page.on('request', (r) => { if (/wa\.me|graph\.facebook\.com/.test(r.url())) whatsapp.push(r.url()); });
 await page.goto(`${h.origin}/m/sultan`); await page.locator('[data-guest-search-form]').waitFor();
 return { ctx, page, errors, whatsapp, selectApi };
}
async function search(page, text) {
 await page.locator('textarea[name=description]').fill(text);
 await page.locator('[data-guest-search]').click();
 await page.locator('[data-results-state]').first().waitFor();
}
async function layoutOk(page, errors, width, step) {
 assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl', `${width}/${step}: rtl`);
 assert.ok(await noOverflow(page), `${width}/${step}: no horizontal scroll`);
 assert.deepEqual(errors, [], `${width}/${step}: no page errors`);
}
try {
 for (const width of WIDTHS) {
  // One visitor per width: this run searches far faster than a person, so each width starts with fresh public limits.
  resetPublicRateLimitStoreForTests();
  const shot = (page, name, full = true) => (width === 390 || width === 320 || width === 1024) ? page.screenshot({ path: path.join(OUT, `${width}-${name}.png`), fullPage: full }) : null;
  // Fresh offer per width, so the «others interested» check is about this run only.
  const id = `public-qa-${width}`;
  h.store.seed(`offices/${OFFICE_A}/opportunities/${id}`, offer);
  for (const other of WIDTHS) if (other !== width) h.store.patch(`offices/${OFFICE_A}/opportunities/public-qa-${other}`, { publicSearchVisible: false });
  h.store.patch(`offices/${OFFICE_A}/opportunities/${id}`, { publicSearchVisible: true });

  // 1 — search as a guest, choose a result, consent, then the client's own WhatsApp (nothing sent for him).
  const choose = async (client, phone) => {
   const { ctx, page, errors, whatsapp, selectApi } = await open(width);
   assert.equal(await page.locator('[data-login-form]').count(), 0, 'no login before searching');
   assert.equal(await page.locator('[data-path="client"]').getAttribute('aria-pressed'), 'true', 'searching is the default path');
   assert.equal(await page.locator('[name=contactPhone]').count(), 0, 'no phone asked before searching');
   assert.equal(await page.locator('[data-guest-analyze]').count(), 0, 'one button: understanding is part of the search');
   if (client === 'first') await shot(page, '0-office');
   await search(page, SEARCH);
   assert.equal(await page.locator('[name=price]').inputValue(), '550000', 'the request was understood');
   assert.equal(await page.locator('[name=propertyType]').inputValue(), 'شقة');
   assert.match(await page.locator('[data-understood]').innerText(), /شقة · تمليك · الملقا · 4 غرف · حتى 550,000 ريال/);
   assert.equal(await page.locator('[data-search-result]').count(), 1);
   assert.ok(!(await page.locator('[data-guest-results]').innerText()).includes('0553331234'), 'owner phone never shown');
   assert.equal(await page.locator('[data-status-label]').first().innerText(), 'متاح');
   assert.ok((await page.locator('[data-search-result]').first().innerText()).includes('نفس الحي'), 'why it matches');
   const notice = await page.locator('[data-search-result] [data-interest-notice]').count();
   if (client === 'first') await shot(page, '1-results');
   await page.locator('[data-choose-result]').first().click();
   await page.locator('[data-guest-select-form]').waitFor();
   await page.locator('[data-guest-select-form] [name=contactName]').fill(client === 'first' ? 'عميل أول' : 'عميل ثان');
   await page.locator('[data-guest-select-form] [name=contactPhone]').fill(phone);
   await page.locator('[name=consentProcessing]').check(); await page.locator('[name=consentContact]').check();
   if (client === 'first') await shot(page, '2-choose', false);
   await page.locator('[data-guest-select]').click();
   const link = page.locator('[data-whatsapp-handoff]');
   await link.waitFor({ timeout: 8000 }).catch(async (error) => {
    const state = {
     width,
     selectApi,
     status: await page.locator('[data-guest-select-form] [role=status]').allTextContents().catch(() => []),
     outcome: await page.locator('[data-guest-outcome]').innerText().catch(() => ''),
     pageErrors: errors
    };
    console.error('PUBLIC_SEARCH_SELECT_DIAGNOSTIC', JSON.stringify(state));
    throw error;
   });
   const href = new URL(await link.getAttribute('href'));
   assert.equal(href.hostname, 'wa.me'); assert.equal(href.pathname, '/966501111111', 'the office number');
   assert.match(href.searchParams.get('text'), new RegExp(`${OFFICE_A}:${id}`));
   assert.equal(await page.locator('[data-contact-state]').getAttribute('data-contact-state'), 'OPEN_WHATSAPP');
   assert.ok((await page.locator('[data-guest-outcome]').innerText()).includes('يعتمده المكتب'));
   if (client === 'first') await shot(page, '3-handoff', false);
   await layoutOk(page, errors, width, 'choose');
   assert.deepEqual(whatsapp, [], 'the page never opens WhatsApp by itself');
   await ctx.close();
   return notice;
  };
  assert.equal(await choose('first', '0557000222'), 0, 'no interest notice without real interest');
  assert.equal(await choose('second', '0557000333'), 1, 'the next client sees real interest from another client');

  // 2 — «أرسل طلبي للمكتب العقاري»: wrong phone refused; saved once; the office's own request.
  {
   const { ctx, page, errors } = await open(width);
   const phone = `05571${String(width).padStart(5, '0')}`;
   await search(page, SEARCH);
   await page.locator('[data-guest-request-open]').click();
   const sheet = page.locator('[data-guest-request-form]'); await sheet.waitFor();
   await sheet.locator('[name=contactName]').fill('ريم الحربي');
   await sheet.locator('[name=contactPhone]').fill('0512');
   await sheet.locator('[name=consentProcessing]').check();
   await sheet.locator('[data-guest-request]').click();
   assert.match(await sheet.locator('.os-alert.bad').innerText(), /رقم جوال سعودي صحيح/);
   await sheet.locator('[name=contactName]').fill('ريم');
   await sheet.locator('[name=contactPhone]').fill(phone);
   await sheet.locator('[data-guest-request]').click();
   assert.match(await sheet.locator('.os-alert.bad').innerText(), /الاسم الأول واسم العائلة/);
   assert.equal(intakesOf(OFFICE_A).filter((d) => d.phone === phone).length, 0, 'nothing saved from an invalid form');
   await sheet.locator('[name=contactName]').fill('ريم الحربي');
   await sheet.locator('[name=consentProcessing]').uncheck();
   await sheet.locator('[data-guest-request]').click();
   assert.match(await sheet.locator('.os-alert.bad').innerText(), /الموافقة/);
   await sheet.locator('[name=consentProcessing]').check();
   await sheet.locator('[name=contactPreference]').selectOption('call');
   if (width === 390 || width === 320) await shot(page, '4-request-form', false);
   await sheet.locator('[data-guest-request]').click();
   const shown = await page.locator('[data-request-reference]').getAttribute('data-request-reference');
   assert.match(shown, /^IQ-[A-Z0-9]{8}$/);
   if (width === 390 || width === 320) await shot(page, '5-request-sent', false);
   const saved = intakesOf(OFFICE_A).filter((d) => d.phone === phone);
   assert.equal(saved.length, 1, 'one intake');
   assert.equal(saved[0].status, 'processed', 'processed by the Worker');
   assert.equal(saved[0].publicReference, shown);
   assert.equal(saved[0].details, SEARCH, 'the client\'s own words kept');
   const record = opportunitiesOf(OFFICE_A).find((r) => r.publicReference === shown);
   assert.ok(record, 'a request in the office of the link');
   assert.equal(record.opportunityKind, 'REQUEST'); assert.equal(record.contactPreference, 'call'); assert.equal(record.contactName, 'ريم الحربي');
   assert.ok(JSON.parse(record.guestSearchReferencesJson).includes(`${OFFICE_A}:${id}`), 'linked to the results the client saw');
   assert.ok(!opportunitiesOf(OFFICE_B).some((r) => r.publicReference === shown), 'never in another office');
   // Closing and pressing again shows the same request; nothing new is created.
   await page.keyboard.press('Escape');
   await page.locator('[data-guest-request-open="sent"]').click();
   assert.equal(await page.locator('[data-request-reference]').getAttribute('data-request-reference'), shown);
   assert.equal(intakesOf(OFFICE_A).filter((d) => d.phone === phone).length, 1, 'no second request');
   await layoutOk(page, errors, width, 'request');
   await ctx.close();
  }

  // 3 — nothing matches: say so, and the request still reaches the office.
  {
   const { ctx, page, errors } = await open(width);
   const phone = `05572${String(width).padStart(5, '0')}`;
   await search(page, NOTHING);
   assert.equal(await page.locator('[data-search-result]').count(), 0, 'no invented results');
   assert.match(await page.locator('[data-guest-results]').innerText(), /ما لقينا عقارًا مطابقًا حاليًا/);
   if (width === 390 || width === 320) await shot(page, '6-no-results');
   await page.locator('[data-guest-request-open]').click();
   const sheet = page.locator('[data-guest-request-form]');
   await sheet.locator('[name=contactName]').fill('سعد القحطاني'); await sheet.locator('[name=contactPhone]').fill(phone);
   await sheet.locator('[name=consentProcessing]').check(); await sheet.locator('[data-guest-request]').click();
   const shown = await page.locator('[data-request-reference]').getAttribute('data-request-reference');
   const record = opportunitiesOf(OFFICE_A).find((r) => r.publicReference === shown);
   assert.equal(record?.opportunityKind, 'REQUEST', 'kept as a request the office follows up');
   assert.equal(record.propertyType, 'فيلا'); assert.equal(record.contactPreference, 'whatsapp');
   await layoutOk(page, errors, width, 'no-results');
   await ctx.close();
  }

  // 4 — scope: this office's offers by default; all published offers on request.
  {
   h.store.seed(`offices/${OFFICE_B}/opportunities/public-b-${width}`, { ...offer, officeId: OFFICE_B, contactPhone: '0559998877', publicSearchVisible: true, salePrice: 520000, priceOrBudget: 520000 });
   const { ctx, page, errors } = await open(width);
   assert.equal(await page.locator('[name=scope]').inputValue(), 'office');
   await search(page, SEARCH);
   const own = await page.locator('[data-search-result]').evaluateAll((cards) => cards.map((c) => c.dataset.searchResult));
   assert.ok(own.every((ref) => ref.startsWith(`${OFFICE_A}:`)), 'only this office');
   await page.locator('[name=scope]').selectOption('all');
   await page.locator('[data-guest-search]').click();
   await page.locator(`[data-search-result="${OFFICE_B}:public-b-${width}"]`).waitFor({ state: 'attached' });
   assert.ok(!(await page.locator('[data-guest-results]').innerText()).includes('0559998877'), 'no owner data from any office');
   await layoutOk(page, errors, width, 'scope');
   h.store.patch(`offices/${OFFICE_B}/opportunities/public-b-${width}`, { publicSearchVisible: false });
   await ctx.close();
  }

  // 5 — «لدي عقار وأريد عرضه»: saved for the office's review, never public by itself.
  {
   const { ctx, page, errors } = await open(width);
   const phone = `05573${String(width).padStart(5, '0')}`;
   await page.locator('[data-path="owner"]').click();
   assert.equal(await page.locator('[data-path="owner"]').getAttribute('aria-pressed'), 'true');
   assert.equal(await page.locator('[data-guest-search-form]').count(), 0, 'the form follows the choice');
   await page.locator('[data-fill-mode="manual"]').click();
   await page.getByRole('button', { name: 'بيع', exact: true }).click();
   await page.fill('input[name="propertyType"]', 'فيلا'); await page.fill('input[name="city"]', 'الرياض'); await page.fill('input[name="district"]', 'النرجس');
   await page.fill('input[name="price"]', '2100000'); await page.fill('input[name="area"]', '400'); await page.fill('input[name="rooms"]', '5');
   await page.fill('textarea[name="notes"]', 'فيلا درج داخلي وواجهة شمالية');
   await page.fill('input[name="contactName"]', 'فهد العتيبي'); await page.fill('input[name="contactPhone"]', phone);
   await page.locator('[data-consent-processing]').check();
   if (width === 390 || width === 320) await shot(page, '7-offer-form');
   await layoutOk(page, errors, width, 'offer-form');
   await page.getByRole('button', { name: 'إرسال', exact: true }).click();
   await page.locator('[data-offer-review="PENDING_REVIEW"]').waitFor();
   const shown = await page.locator('[data-public-reference]').getAttribute('data-public-reference');
   if (width === 390 || width === 320) await shot(page, '8-offer-sent');
   const record = opportunitiesOf(OFFICE_A).find((r) => r.publicReference === shown);
   assert.equal(record?.opportunityKind, 'OFFER', 'an offer in the office');
   assert.notEqual(record.publicSearchVisible, true, 'not public before the office reviews it');
   await layoutOk(page, errors, width, 'offer-sent');
   await ctx.close();
  }
  console.log(`✔ ${width}px: search, choose, send request, no results, scope, owner offer`);
 }
 const page = await browser.newPage(); await page.goto(`${h.origin}/m/sultan`); await page.locator('[data-guest-search-form]').waitFor(); assert.equal(await page.locator('[name=scope]').inputValue(), 'office'); await page.close();
 assert.deepEqual(external, [], 'no WhatsApp message and no paid AI call left the system');
 console.log(`Guest journeys: ${WIDTHS.length} widths — search, choose, send request (with and without results), scope, owner offer — passed; nothing sent outside.`);
} finally { globalThis.fetch = realFetch; await browser.close(); h.server.close(); }
