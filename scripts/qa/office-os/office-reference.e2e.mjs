import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startOfficeOsHarness, OFFICE_A, OWNER_A, BROKER_A2 } from './server.mjs';
const harness = await startOfficeOsHarness();
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
const out='qa/office-reference'; fs.mkdirSync(out,{recursive:true});
const errors=[];const results=[];
try {
const context=await browser.newContext({locale:'ar-SA'});
await context.addInitScript(([u,o])=>{localStorage.setItem('harness.uid',u);localStorage.setItem('iaqar.officeId',o)},[OWNER_A,OFFICE_A]);
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
for(const width of [360,390,430,768,1280]){
 await page.setViewportSize({width,height:Math.round(width*1536/864)});
 await page.goto(harness.origin+'/#/office'); await page.locator('.ref-office-profile').waitFor();
 const toggle=page.locator('.ref-profile-toggle');
 await toggle.waitFor({timeout:3000});
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('.ref-office-profile h2').isVisible(),true);
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,rtl:getComputedStyle(document.querySelector('.os-app')).direction,cards:[...document.querySelectorAll('[data-reference-tool]')].map(n=>({route:n.dataset.toolRoute,x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})),broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length}));
 assert.ok(metrics.overflow<=1,JSON.stringify(metrics));assert.equal(metrics.rtl,'rtl');assert.equal(metrics.broken,0);
 assert.equal(metrics.cards.length,12);assert.ok(metrics.cards[0].x>metrics.cards[1].x);
 await page.screenshot({path:`${out}/office-${width}.png`,fullPage:true});results.push({width,...metrics});
}
for(const route of await page.locator('[data-reference-tool]').evaluateAll(ns=>ns.map(n=>n.dataset.toolRoute))){
 await page.goto(harness.origin+'/#/office');await page.locator(`[data-reference-tool][data-tool-route="${route}"]`).click(); await page.waitForTimeout(100);if(route==='support') assert.equal(await page.getByRole('heading',{name:'بلاغ أو استفسار',exact:true}).count(),1); else assert.equal(await page.evaluate(()=>location.hash),'#/'+route);
}
await page.goto(harness.origin+'/#/office');
await page.reload();await page.locator('.ref-office-profile').waitFor();
await page.getByRole('button',{name:'تغيير الصورة',exact:true}).click();
assert.equal(await page.evaluate(()=>location.hash),'#/settings/profile');
await page.goto(harness.origin+'/#/office');
await page.getByRole('button',{name:'القائمة والإعدادات',exact:true}).click();
assert.ok(await page.getByText('تسجيل الخروج',{exact:true}).isVisible());
const brokerContext=await browser.newContext({locale:'ar-SA'});
await brokerContext.addInitScript(([u,o])=>{localStorage.setItem('harness.uid',u);localStorage.setItem('iaqar.officeId',o)},[BROKER_A2,OFFICE_A]);
const brokerPage=await brokerContext.newPage();
await brokerPage.goto(harness.origin+'/#/office');await brokerPage.locator('.ref-office-profile').waitFor();
assert.equal(await brokerPage.getByRole('button',{name:'تغيير الصورة',exact:true}).count(),0);
await brokerPage.close();
assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));console.log('PASS widths, collapse, 12 routes, RTL, images, JS');
}finally{await browser.close();harness.server.close();}
