import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startOfficeOsHarness, OFFICE_A } from './server.mjs';
const h=await startOfficeOsHarness();
const browser=await chromium.launch({executablePath:chromium.executablePath()});
try {
 h.store.seed(`offices/${OFFICE_A}/opportunities/public-qa`,{officeId:OFFICE_A,opportunityKind:'OFFER',purpose:'SALE',transactionType:'sale',propertyType:'شقة',city:'الرياض',district:'الملقا',priceOrBudget:500000,salePrice:500000,advertiserRole:'OWNER',contactPhone:'0553331234',lifecycleStatus:'ACTIVE',publicSearchVisible:true,rooms:4,version:1});
 for(const width of [320,390,1024]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${h.origin}/?view=search`);await page.locator('[data-guest-search-form]').waitFor();
  assert.equal(await page.locator('[data-login-form]').count(),0);
  await page.locator('textarea[name=description]').fill('مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف');
  await page.locator('[data-guest-analyze]').click();await page.waitForFunction(()=>document.querySelector('[name=price]').value==='550000');
  assert.equal(await page.locator('[name=propertyType]').inputValue(),'شقة');
  await page.locator('[name=contactName]').fill('عميل تجربة');await page.locator('[name=contactPhone]').fill('0557000222');await page.locator('[name=channel]').selectOption('whatsapp');
  await page.locator('[name=consentProcessing]').check();await page.locator('[name=consentContact]').check();await page.locator('[data-guest-search]').click();
  await page.locator('[data-search-result]').waitFor();assert.equal(await page.locator('[data-search-result]').count(),1);
  assert.ok(await page.getByText('الإرسال الآلي لهذه القناة غير مفعّل حاليًا',{exact:false}).count());
  assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`/tmp/iaqar-public-search-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage();await page.goto(`${h.origin}/m/sultan`);await page.locator('[data-guest-search-form]').waitFor();assert.equal(await page.locator('[name=scope]').inputValue(),'office');await page.close();
 console.log('Guest search: 3 responsive end-to-end journeys and office-default routing passed.');
} finally {await browser.close();h.server.close();}
