// Guest journey in a real browser: write → see matches → choose → consent → WhatsApp handoff.
//   node scripts/qa/office-os/public-search.e2e.mjs      (WIDTHS=390 narrows; OUT_DIR for screenshots)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { startOfficeOsHarness, OFFICE_A } from './server.mjs';
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [320, 360, 390, 430, 768, 1024, 1440];
const OUT = process.env.OUT_DIR || '/tmp/iaqar-public-search';
fs.mkdirSync(OUT, { recursive: true });
const h = await startOfficeOsHarness();
const browser = await chromium.launch();
const offer = { officeId: OFFICE_A, opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'شقة', city: 'الرياض', district: 'الملقا', priceOrBudget: 500000, salePrice: 500000, advertiserRole: 'OWNER', contactPhone: '0553331234', contactName: 'مالك لا يظهر', lifecycleStatus: 'ACTIVE', publicSearchVisible: true, rooms: 4, version: 1 };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
try {
 for (const width of WIDTHS) {
  // Fresh offer per width, so the «others interested» check is about this run only.
  const id = `public-qa-${width}`;
  h.store.seed(`offices/${OFFICE_A}/opportunities/${id}`, offer);
  for (const other of WIDTHS) if (other !== width) h.store.patch(`offices/${OFFICE_A}/opportunities/public-qa-${other}`, { publicSearchVisible: false });
  h.store.patch(`offices/${OFFICE_A}/opportunities/${id}`, { publicSearchVisible: true });
  const run = async (client, phone) => {
   const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ar-SA' });
   const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
   await page.goto(`${h.origin}/?view=search`); await page.locator('[data-guest-search-form]').waitFor();
   assert.equal(await page.locator('[data-login-form]').count(), 0, 'no login before searching');
   assert.equal(await page.locator('[name=contactPhone]').count(), 0, 'no phone asked before a choice');
   await page.locator('textarea[name=description]').fill('مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف');
   await page.locator('[data-guest-analyze]').click(); await page.waitForFunction(() => document.querySelector('[name=price]').value === '550000');
   assert.equal(await page.locator('[name=propertyType]').inputValue(), 'شقة');
   await page.locator('[data-search-result]').first().waitFor();
   assert.equal(await page.locator('[data-search-result]').count(), 1);
   assert.ok(!(await page.locator('[data-guest-results]').innerText()).includes('0553331234'), 'owner phone never shown');
   assert.equal(await page.locator('[data-status-label]').first().innerText(), 'متاح');
   const notice = await page.locator('[data-search-result] [data-interest-notice]').count();
   if (client === 'first') await page.screenshot({ path: path.join(OUT, `${width}-1-results.png`), fullPage: true });
   await page.locator('[data-choose-result]').first().click();
   await page.locator('[data-guest-select-form]').waitFor();
   // The sheet moves focus to the name one frame after it opens: type only once that has happened (a state, not a delay).
   await page.waitForFunction(() => document.activeElement?.name === 'contactName');
   const name = client === 'first' ? 'عميل أول' : 'عميل ثان';
   await page.locator('[data-guest-select-form] [name=contactName]').fill(name);
   await page.locator('[data-guest-select-form] [name=contactPhone]').fill(phone);
   await page.locator('[name=consentProcessing]').check(); await page.locator('[name=consentContact]').check();
   // Each value is in its own field before sending.
   assert.equal(await page.locator('[data-guest-select-form] [name=contactName]').inputValue(), name, `${width}px ${client}: name field`);
   assert.equal(await page.locator('[data-guest-select-form] [name=contactPhone]').inputValue(), phone, `${width}px ${client}: phone field`);
   if (client === 'first') await page.screenshot({ path: path.join(OUT, `${width}-2-choose.png`) });
   await page.locator('[data-guest-select]').click();
   const link = page.locator('[data-whatsapp-handoff]');
   // When the hand-off does not appear, say what the sheet showed instead (error text, button state, worker calls).
   await link.waitFor().catch(async (error) => {
    const sheet = await page.evaluate(() => ({ sheets: document.querySelectorAll('[data-guest-select-form]').length, active: document.activeElement?.name || document.activeElement?.tagName || '', forms: [...document.querySelectorAll('[data-guest-select-form]')].map((f) => ({ status: f.querySelector('.os-feedback')?.hidden === false ? f.querySelector('.os-feedback').textContent.trim() : '', busy: f.querySelector('[data-guest-select]')?.getAttribute('aria-busy') || '', hidden: f.hidden, name: f.querySelector('[name=contactName]')?.value || '', phone: f.querySelector('[name=contactPhone]')?.value || '', processing: f.querySelector('[name=consentProcessing]')?.checked, contact: f.querySelector('[name=consentContact]')?.checked })) })).catch(() => null);
    const calls = h.server.workerCalls.filter((c) => c.path.includes('/os/public/search/select')).slice(-3);
    await page.screenshot({ path: path.join(OUT, `${width}-${client}-handoff-missing.png`), fullPage: true }).catch(() => {});
    throw new Error(`${width}px ${client}: no WhatsApp hand-off — sheet ${JSON.stringify(sheet)}, select calls ${JSON.stringify(calls)}, errors ${JSON.stringify(errors)} (${error.message.split('\n')[0]})`);
   });
   const href = new URL(await link.getAttribute('href'));
   assert.equal(href.hostname, 'wa.me'); assert.equal(href.pathname, '/966501111111', 'the office number');
   assert.match(href.searchParams.get('text'), new RegExp(`${OFFICE_A}:${id}`));
   assert.equal(await page.locator('[data-contact-state]').getAttribute('data-contact-state'), 'OPEN_WHATSAPP');
   assert.ok((await page.locator('[data-guest-outcome]').innerText()).includes('يعتمده المكتب'));
   if (client === 'first') await page.screenshot({ path: path.join(OUT, `${width}-3-handoff.png`) });
   assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
   assert.ok(await noOverflow(page), `no horizontal scroll at ${width}`);
   assert.deepEqual(errors, []);
   await ctx.close();
   return notice;
  };
  assert.equal(await run('first', '0557000222'), 0, 'no interest notice without real interest');
  assert.equal(await run('second', '0557000333'), 1, 'the next client sees real interest from another client');
  console.log(`✔ ${width}px guest journey`);
 }
 // Regression (Staging deploy run 40057732450): a guest who taps the phone field at once keeps it — the sheet's own
 // first focus never takes the field back mid-typing (the phone once landed in the name: «عميل ثان0557000333»).
 {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 844 }, locale: 'ar-SA' });
  const quick = await ctx.newPage();
  await quick.goto(`${h.origin}/?view=search`); await quick.locator('[data-guest-search-form]').waitFor();
  await quick.locator('textarea[name=description]').fill('مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف');
  await quick.locator('[data-guest-analyze]').click(); await quick.locator('[data-choose-result]').first().waitFor();
  // Choose and go straight to the phone in the same moment, before the sheet's next frame.
  await quick.evaluate(() => { document.querySelector('[data-choose-result]').click(); document.querySelector('[data-guest-select-form] [name=contactPhone]').focus(); });
  await quick.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await quick.evaluate(() => document.activeElement?.name), 'contactPhone', 'the phone field kept the guest\'s focus');
  await quick.keyboard.type('0557000555');
  assert.equal(await quick.locator('[data-guest-select-form] [name=contactPhone]').inputValue(), '0557000555');
  assert.equal(await quick.locator('[data-guest-select-form] [name=contactName]').inputValue(), '', 'nothing typed into the name');
  await ctx.close();
  console.log('✔ a quick tap on the phone keeps its focus (no digits in the name)');
 }
 const page = await browser.newPage(); await page.goto(`${h.origin}/m/sultan`); await page.locator('[data-guest-search-form]').waitFor(); assert.equal(await page.locator('[name=scope]').inputValue(), 'office'); await page.close();
 // No match → «أرسل طلبي للمكاتب»: the office link sends to this office, through the shared request path.
 const requestPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
 await requestPage.goto(`${h.origin}/m/sultan`);
 await requestPage.locator('[data-guest-search-form]').waitFor();
 await requestPage.screenshot({ path: path.join(OUT, '390-office-search.png'), fullPage: true });
 await requestPage.locator('textarea[name=description]').fill('أبحث عن فيلا للبيع في درة العقيق بالمدينة المنورة بميزانية 5 ملايين ريال');
 await requestPage.locator('[data-guest-search]').click();
 await requestPage.locator('[data-guest-results] .os-page-title').waitFor();
 assert.equal(await requestPage.locator('[name=price]').inputValue(), '5000000');
 assert.equal(await requestPage.locator('[name=propertyType]').inputValue(), 'فيلا');
 assert.equal(await requestPage.locator('[name=city]').inputValue(), 'المدينة المنورة');
 assert.equal(await requestPage.locator('[name=district]').inputValue(), 'درة العقيق');
 assert.equal(await requestPage.locator('[data-search-result]').count(), 0);
 await requestPage.locator('[data-send-office-request]').first().click();
 await requestPage.locator('[name=requestName]').fill('عميل اختبار');
 await requestPage.locator('[name=requestPhone]').fill('0557000444');
 await requestPage.locator('[name=requestConsentProcessing]').check();
 await requestPage.locator('[name=requestConsentContact]').check();
 await requestPage.screenshot({ path: path.join(OUT, '390-send-request.png'), fullPage: true });
 await requestPage.locator('[data-guest-request-submit]').click();
 await requestPage.locator('[data-request-reference]').waitFor();
 const ref = await requestPage.locator('[data-request-reference]').getAttribute('data-request-reference');
 const saved = h.store.list(`offices/${OFFICE_A}/opportunities`).find((row) => row.publicRequestReference === ref);
 assert.ok(saved, 'request reaches the office request bank');
 assert.equal(saved.officeId, OFFICE_A);
 assert.equal(saved.opportunityKind, 'REQUEST');
 assert.equal(saved.propertyType, 'فيلا');
 assert.equal(saved.budget || saved.priceOrBudget, 5000000);
 assert.ok(await noOverflow(requestPage));
 await requestPage.close();
 console.log('✔ no-match villa request saved in the target office bank');
 console.log(`Guest search: ${WIDTHS.length} widths × 2 clients end-to-end and office-default routing passed.`);
} finally { await browser.close(); h.server.close(); }
