import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B } from './server.mjs';
const harness = await startOfficeOsHarness();
const out = process.env.DIAGNOSTIC_OUT || 'artifacts/inventory-link';
mkdirSync(out,{recursive:true});
const record = {officeId:OFFICE_A,opportunityKind:'OFFER',purpose:'SALE',propertyType:'عمارة',city:'الرياض',district:'درة العقيق',priceOrBudget:3000000,salePrice:3000000,lifecycleStatus:'ACTIVE',publicSearchVisible:true};
harness.store.seed(`offices/${OFFICE_A}/opportunities/building-durra`,record);
harness.store.seed(`offices/${OFFICE_A}/opportunities/private-durra`,{...record,publicSearchVisible:false});
harness.store.seed(`offices/${OFFICE_B}/opportunities/foreign-durra`,{...record,officeId:OFFICE_B});
const browser=await chromium.launch();
const proof=[];
try {
 for (const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900},locale:'ar-SA'});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${harness.origin}/m/sultan`);
  await page.locator('[data-guest-search-form]').waitFor();
  await page.locator('textarea[name=description]').fill('اش عندك عروض في درة العقيق؟');
  await page.locator('[data-guest-search]').click();
  await page.locator(`[data-search-result="${OFFICE_A}:building-durra"]`).waitFor();
  assert.equal(await page.locator('[data-search-result]').count(),1);
  assert.match(await page.locator('[data-guest-results]').innerText(),/عمارة/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/inventory-${width}.png`,fullPage:true});
  proof.push({width,reference:`${OFFICE_A}:building-durra`,price:3000000,unauthorizedResults:0,overflow:false,consoleErrors:errors});
  await page.close();
 }
 writeFileSync(`${out}/browser-inventory-proof.json`,JSON.stringify(proof,null,2));
 console.log('Inventory enquiry browser proof passed',JSON.stringify(proof));
} finally {await browser.close();harness.server.close();}
