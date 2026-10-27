import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startOfficeOsHarness } from './server.mjs';
import { seedStates } from './seed.mjs';
const out=process.env.OUT_DIR; assert.ok(out); await fs.mkdir(out,{recursive:true});
const h=await startOfficeOsHarness(); await seedStates(h);
const browser=await chromium.launch(); const results=[];
const guard=async context=>context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
try {
for(const width of [320,390,430,1024,1280]) {
 const context=await browser.newContext({viewport:{width,height:900},locale:'ar-SA',serviceWorkers:'block'});await guard(context);
 const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(h.origin);await page.locator('[name="phone"]').fill('0501111111');await page.locator('[name="password"]').fill('pass-a');
 await page.getByRole('button',{name:'دخول المكتب',exact:true}).click();await page.locator('.ref-office-tools,[data-smart-office]').first().waitFor();
 await page.screenshot({path:`${out}/${width}-office.png`,fullPage:true});
 if(!process.env.BASELINE){
  for(const [label,route] of [['العروض والطلبات','repo'],['الصفقات','deals'],['الوارد','inbox'],['المزيد','more'],['المكتب','office']]){
   await page.locator('.ref-bottom').getByRole('button',{name:label,exact:true}).click();await page.waitForURL(`**/#/${route}`);
   await page.locator('.ref-bottom [aria-current="page"]').filter({hasText:label}).waitFor();
   assert.equal(await page.locator('.ref-bottom [aria-current="page"]').innerText(),label);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route);
   await page.screenshot({path:`${out}/${width}-${route}.png`,fullPage:true});
  }
  if(width===390){
   for(const route of ['more/tools','tools/guide','tools/forms','tools/calculator','tools/services','tools/market','library','settings/link','more/support','inbox?tab=conversations','conversations']){
    await page.goto(`${h.origin}/#/${route}`);await page.locator('.ref-bottom').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route);
   }
   await page.goto(`${h.origin}/#/more/tools`);
   for(const label of ['الدليل','النماذج','الحاسبة','الخدمات الرسمية'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1);
   await page.evaluate(async()=>{const {state}=await import('/os/core/state.js');state.error='تعذر تحميل المهام';location.hash='#/office';});
   await page.locator('[data-smart-office] .os-alert.bad').first().waitFor();
   assert.equal(await page.locator('[data-agent-needs]').innerText(),'تعذر تحميل المهام — أعد فتح المكتب للمحاولة');
   await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).first().click();await page.waitForFunction(()=>!document.querySelector('[data-smart-office] .os-alert.bad'));
  }
 }
 assert.deepEqual(errors,[]);results.push({width,passed:true});await context.close();
}
if(!process.env.BASELINE){
 const context=await browser.newContext({serviceWorkers:'block'});await guard(context);const page=await context.newPage();await page.goto(h.origin);
 await page.locator('[name="phone"]').fill('0502222222');await page.locator('[name="password"]').fill('pass-a2');await page.getByRole('button',{name:'دخول المكتب',exact:true}).click();await page.locator('[data-smart-office]').waitFor();
 await page.locator('.ref-bottom').getByRole('button',{name:'المزيد',exact:true}).click();await page.getByRole('button',{name:'أدوات مساندة',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'ملف المكتب والإعدادات',exact:true}).count(),0);
 await page.locator('[data-more-route="more/link"]').click();await page.getByRole('button',{name:'مشاركة رابط المكتب',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'معاينة بوابة العميل',exact:true}).count(),1);
 await page.goto(`${h.origin}/#/settings/brokers`);await page.getByText('هذه الإعدادات لمدير المكتب فقط.',{exact:true}).waitFor();await context.close();
}
}finally{await browser.close();h.server.close();await fs.writeFile(`${out}/results.json`,JSON.stringify(results,null,2));}
console.log(`${results.length}/5 widths passed`);
