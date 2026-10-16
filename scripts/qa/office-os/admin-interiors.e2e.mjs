// Isolated admin UI fixture: authorization/transport mocked only in this test.
// Product AdminApi and all original action handlers run unchanged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startOfficeOsHarness } from './server.mjs';
const out=`qa/structural-visual/admin-${process.env.SOURCE_REF?'before':'after'}`;
fs.mkdirSync(out,{recursive:true});
const harness=await startOfficeOsHarness(); const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined}); const results=[];
const office={recordType:'office',officeId:'office-alpha',officeName:'مكتب الاختبار العقاري',brokerName:'الوسيط التجريبي',phone:'0501111111',licenseNumber:'1234567890',approvalStatus:'approved',accountStatus:'active',subscriptionStatus:'trial',licenseStatus:'valid'};
try {
 for(const width of (process.env.WIDTHS||'320,360,390,430,768,1024,1440').split(',').map(Number)) {
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ar-SA'}); const page=await context.newPage(); const errors=[]; const writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>localStorage.setItem('harness.uid','uid-owner-a'));
  if(process.env.SOURCE_REF) await context.route('**/admin/index.html',route=>{
   let body=execFileSync('git',['show',`${process.env.SOURCE_REF}:public/admin/index.html`],{encoding:'utf8'});
   body=body.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>\s*/g,'')
    .replace('<script src="/__/firebase/init.js"></script>',`<script>${fs.readFileSync(new URL('./firebase-stub.js',import.meta.url),'utf8')}</script>`)
    .replace('<script src="/js/runtime-config.js"></script>','<script src="/js/runtime-config.js"></script><script>window.IAQAR.workerBase=location.origin+"/worker";</script>');
   return route.fulfill({body,contentType:'text/html'});
  });
  if(process.env.SOURCE_REF) await context.route(/\/(?:js\/admin-console\.js|os\/(?:site-theme\.css|os\.css))$/,route=>{
   const pathname=new URL(route.request().url()).pathname;
   const body=execFileSync('git',['show',`${process.env.SOURCE_REF}:public${pathname}`],{encoding:'utf8'});
   return route.fulfill({body,contentType:pathname.endsWith('.css')?'text/css':'text/javascript'});
  });
  await context.route('**/worker/admin/**',async route=>{
   const req=route.request(); const url=new URL(req.url()); let payload={};
   if(req.method()==='POST') {writes.push({path:url.pathname,body:req.postDataJSON()});payload={ok:true};}
   else if(url.pathname.endsWith('/session')) payload={admin:{email:'admin@test.local'}};
   else if(url.pathname.endsWith('/overview')) payload={overview:{totalOffices:1,pendingApprovals:0,approvedOffices:1}};
   else if(url.pathname.endsWith('/offices')) payload={items:[office]};
   else if(url.pathname.endsWith('/office')) payload={office,notes:[{note:'ملاحظة للاختبار'}],audit:[{action:'approved'}]};
   else if(url.pathname.endsWith('/activity')) payload={activity:{historicalDataAvailable:true,loginCount7d:4}};
   else if(url.pathname.endsWith('/audit-log')) payload={items:[{action:'approved',officeId:office.officeId,performedBy:'admin@test.local'}]};
   await route.fulfill({json:payload});
  });
  await page.goto(`${harness.origin}/admin/index.html`);
  await page.locator('#mainNav [data-view="overview"]').waitFor();
  async function capture(name) {
   await page.evaluate(()=>document.fonts.ready);
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,rtl:document.documentElement.dir,sections:document.querySelectorAll('#viewRoot [data-ui="surface"]').length}));
   assert.ok(layout.overflow<=1,`${name}/${width}: overflow ${layout.overflow}`);assert.equal(layout.rtl,'rtl');
   await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});results.push({name,width,...layout});
  }
  await page.locator('#viewRoot h2').waitFor();await capture('overview');
  await page.locator('[data-view="offices"]').click();await page.locator('[data-detail]').waitFor();await capture('offices');
  await page.locator('[data-detail]').click();await page.locator('#saveNoteBtn').waitFor();await capture('detail');
  if(!process.env.SOURCE_REF) {
   assert.equal(await page.locator('#viewRoot .os-office-section').count(),5);
   await page.locator('#subscriptionStatus').selectOption('active');await page.locator('#subscriptionExpiresAt').fill('2027-01-15');await page.locator('#saveSubscriptionBtn').click();
   await page.waitForFunction(()=>document.getElementById('consoleStatus').textContent.includes('تم تحديث الاشتراك'));
   assert.deepEqual(writes.at(-1).body,{officeId:office.officeId,subscriptionStatus:'active',subscriptionExpiresAt:'2027-01-15'});
   await page.locator('#saveNoteBtn').waitFor();await page.locator('#adminNote').fill('ملاحظة محفوظة');await page.locator('#saveNoteBtn').click();
   await page.waitForFunction(()=>document.getElementById('consoleStatus').textContent.includes('تمت إضافة الملاحظة'));
   assert.deepEqual(writes.at(-1).body,{officeId:office.officeId,note:'ملاحظة محفوظة'});
   await page.locator('#licenseExpiresAt').fill('2028-02-20');await page.locator('#saveLicenseBtn').click();
   await page.waitForFunction(()=>document.getElementById('consoleStatus').textContent.includes('تم تحديث الترخيص'));
   assert.deepEqual(writes.at(-1).body,{officeId:office.officeId,licenseExpiresAt:'2028-02-20'});
   await page.locator('#suspendReason').fill('سبب اختباري');await page.locator('#suspendBtn').click();
   await page.waitForFunction(()=>document.getElementById('consoleStatus').textContent.includes('تم إيقاف المكتب'));
   assert.deepEqual(writes.at(-1).body,{officeId:office.officeId,reason:'سبب اختباري'});
   await page.locator('#reactivateBtn').click();
   await page.waitForFunction(()=>document.getElementById('consoleStatus').textContent.includes('تمت إعادة التفعيل'));
   assert.deepEqual(writes.at(-1).body,{officeId:office.officeId,reason:''});
  }
  for(const name of ['activity','billing','audit']) {
   await page.locator(`[data-view="${name}"]`).click();await page.locator('#viewRoot h2').waitFor();await capture(name);
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({fixture:'UI transport only; not live platform admin authorization',results},null,2));console.log(`PASS ${results.length} admin interior captures; five management action payloads preserved at all widths`);
} finally {await browser.close();harness.server.close();}
