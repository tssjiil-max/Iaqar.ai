import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {startOfficeOsHarness,OFFICE_A} from './server.mjs';
const out=process.env.OUT_DIR;assert.ok(out);await fs.mkdir(out,{recursive:true});
const h=await startOfficeOsHarness();
h.env.META_APP_ID='123456';h.env.META_CONFIG_ID='987654';h.env.META_APP_SECRET='test-only';
const browser=await chromium.launch();
try {
 for(const width of [390,1280]) {
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(h.origin);await page.locator('[name="phone"]').fill('0501111111');await page.locator('[name="password"]').fill('pass-a');
  await page.getByRole('button',{name:'دخول المكتب',exact:true}).click();await page.locator('[data-smart-office]').waitFor();
  await page.goto(`${h.origin}/#/settings/channels`);
  await page.locator('[data-wa-readiness="UNVERIFIED"]').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/${width}-unverified.png`,fullPage:true});
  h.store.seed(`offices/${OFFICE_A}/integrations/whatsapp`,{phoneNumberId:'qa-phone'});
  h.store.seed('whatsapp_accounts/qa-phone',{officeId:OFFICE_A,status:'connected',isOnBizApp:true,platformType:'CLOUD_API',metaPhoneStatus:'CONNECTED',connectedAt:'2026-10-29T07:00:00Z'});
  await page.reload();await page.locator('[data-wa-readiness="COEXISTENCE_ACTIVE"]').waitFor();
  assert.deepEqual(errors,[]);await context.close();
  h.store.seed(`offices/${OFFICE_A}/integrations/whatsapp`,{});
 }
 console.log('2/2 widths: unverified and historical Meta evidence rendered; no external network');
}finally{await browser.close();h.server.close();}
