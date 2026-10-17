import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { startOfficeOsHarness, OFFICE_A, OWNER_A } from './server.mjs';
const out=process.env.OUT_DIR||'qa/economic-test';fs.mkdirSync(out,{recursive:true});
const h=await startOfficeOsHarness({projectId:'iaqar-ai-staging'});
Object.assign(h.env,{ECONOMIC_TEST_MODE:'enabled',ECONOMIC_TEST_OFFICE_ID:OFFICE_A,GEMINI_API_KEY:'forbidden-test-key'});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});const checks=[];
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844},locale:'ar-SA'});
  await context.addInitScript(([uid,officeId])=>{localStorage.setItem('harness.uid',uid);localStorage.setItem('iaqar.officeId',officeId);},[OWNER_A,OFFICE_A]);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${h.origin}/#/agent/economic`);await page.locator('[data-economic-form]').waitFor({state:'visible'});
  await page.getByRole('button',{name:'عرض أرض',exact:true}).click();await page.locator('[data-economic-ingest]').click();
  let offer=page.locator('[data-economic-message]').filter({has:page.locator('[data-economic-save]')}).last();
  await offer.locator('[data-economic-name]').fill('مالك تجريبي');await offer.locator('[data-economic-phone]').fill(width===390?'0551234001':'0551234002');await offer.locator('[data-economic-confirm]').check();await offer.locator('[data-economic-save]').click();
  await page.locator('[data-economic-sold]').last().waitFor();
  await page.getByRole('button',{name:'طلب شراء',exact:true}).click();await page.locator('[data-economic-ingest]').click();
  let request=page.locator('[data-economic-message]').filter({has:page.locator('[data-economic-save]')}).last();
  await request.locator('[data-economic-name]').fill('مشتري تجريبي');await request.locator('[data-economic-phone]').fill(width===390?'0552345001':'0552345002');await request.locator('[data-economic-confirm]').check();await request.locator('[data-economic-save]').click();
  await page.locator('[data-economic-search]').last().click();await page.getByText(/نتائج محرك المطابقة الفعلي: [12]/).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/economic-${width}.png`,fullPage:true});
  await page.locator('[data-economic-pair]').last().click();await page.locator('[data-economic-approve-confirm]').last().check();await page.locator('[data-economic-approve]').last().click();
  await page.getByRole('button',{name:'فتح مسار الصفقة'}).last().click();await page.waitForURL(/#\/journey\//);await page.getByText(/الصفقة|الفرصة/).first().waitFor();
  await page.screenshot({path:`${out}/economic-deal-${width}.png`,fullPage:true});
  await page.goto(`${h.origin}/#/agent/economic`);await page.locator('[data-economic-form]').waitFor({state:'visible'});
  await page.locator('[data-economic-sold-confirm]').last().check();await page.locator('[data-economic-sold]').last().click();await page.getByText(/تم تسجيل البيع للعرض المحدد/).waitFor();
  await page.locator('[data-economic-search]').last().click();await page.getByText('لا توجد عقارات مؤهلة مطابقة الآن.').waitFor();
  await page.getByRole('button',{name:'إبلاغ بيع',exact:true}).click();await page.locator('[data-economic-ingest]').click();await page.getByText(/إبلاغ عن حالة عقار: لم يُعدّل أي سجل/).last().waitFor();
  assert.deepEqual(errors,[]);checks.push({width,rtl:true,overflow:false,intake:true,save:true,matching:true,journeyOpened:true,soldExclusion:true,availabilityReportRequiresConfirmation:true});
  await context.close();
 }
 console.log(JSON.stringify({ok:true,transport:'local Worker + in-memory Firestore; browser UI real',checks}));fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks},null,2));
}finally{await browser.close();h.server.close();}
