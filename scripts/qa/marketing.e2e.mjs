import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startOfficeOsHarness,OFFICE_A,OFFICE_B,OWNER_A,OWNER_B } from './office-os/server.mjs';
const out=process.env.OUT_DIR||'/tmp/iaqar-marketing-qa';fs.mkdirSync(out,{recursive:true});
const h=await startOfficeOsHarness();const browser=await chromium.launch({headless:true});const errors=[];const checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
try {
 for(const [office,uid,name] of [[OFFICE_A,OWNER_A,'مكتب سلطان العقاري'],[OFFICE_B,OWNER_B,'مكتب الأفق للعقار']]) {
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ar-SA',acceptDownloads:true});
  await ctx.addInitScript(({office,uid})=>{localStorage.setItem('harness.uid',uid);localStorage.setItem('iaqar.officeId',office);},{office,uid});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(h.origin+'/?office='+office+'#/tools/marketing');
  await expect(p.getByRole('heading',{name:'مدير التسويق',exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'تجهيز الحملة',exact:true}).first()).toBeVisible();
  await p.getByRole('button',{name:'تجهيز الحملة',exact:true}).first().click();await expect(p.locator('.os-marketing-preview')).toHaveJSProperty('width',1080);
  check('identity '+office,await p.evaluate(()=>document.querySelector('.os-marketing-preview').width===1080));
  await p.locator('[data-marketing-headline]').fill('تعرّف على مكتبنا العقاري');await p.locator('[data-marketing-body]').fill('أرسل عقارك أو طلبك عبر رابط المكتب');
  await expect(p.locator('.os-marketing-preview')).toHaveJSProperty('width',1080);await expect(p.locator('.os-marketing-studio p.os-error')).toHaveText('');
  await p.locator('[data-marketing-save]').click();await expect(p.getByRole('button',{name:'فتح وتعديل',exact:true})).toBeVisible();
  await p.locator('[data-marketing-approve]').click();await expect(p.getByText('معتمد — جاهز للمشاركة',{exact:true})).toBeVisible();
  const download= p.waitForEvent('download');await p.locator('[data-marketing-download]').click();const d=await download;const file=path.join(out,office+'-square.png');await d.saveAs(file);const bytes=fs.readFileSync(file);check('PNG signature and 1080×1080 '+office,bytes.toString('hex',0,8)==='89504e470d0a1a0a'&&bytes.readUInt32BE(16)===1080&&bytes.readUInt32BE(20)===1080);
  await p.screenshot({path:path.join(out,office+'-studio.png'),fullPage:true});
  for(const width of [360,390,430]){await p.setViewportSize({width,height:844});check('no mobile overflow '+office+' '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const variants=await p.evaluate(async()=>{
   const {drawMarketing,marketingPng}=await import('/os/core/marketing-renderer.js');const {marketingProfile,makeDraft}=await import('/os/domain/marketing-domain.js');const {session}=await import('/os/core/session.js');const {officePublicLink}=await import('/os/views/shell.js');const profile=marketingProfile(session.office,officePublicLink());
   const results=[];for(const size of ['square','story','social','banner'])for(const font of ['plex','tajawal','naskh','kufi']){
    const c=document.createElement('canvas');await drawMarketing(c,profile,makeDraft({headline:'مكتبنا العقاري',body:'تواصل معنا',size,font}));const blob=await marketingPng(c);results.push({size,font,w:c.width,h:c.height,bytes:blob.size,type:blob.type});
   }return results;
  });check('all export sizes '+office,variants.length===16&&variants.every(v=>v.type==='image/png'&&v.bytes>10000));
  const fonts=await p.evaluate(async()=>{for(const font of ['Tajawal','Noto Naskh Arabic','Noto Kufi Arabic']){await document.fonts.load(`600 52px "${font}"`);}return [...document.fonts].map(f=>({family:f.family,status:f.status}));});
  check('actual Arabic fonts loaded '+office,['Tajawal','Noto Naskh Arabic','Noto Kufi Arabic'].every(f=>fonts.some(x=>x.family===f&&x.status==='loaded')));
  await p.getByRole('button',{name:'فرص الظهور',exact:true}).click();await expect(p.getByText('يتطلب ربط خدمة البحث',{exact:true})).toBeVisible();
  await p.reload();await expect(p.getByRole('button',{name:'تجهيز الحملة',exact:true}).first()).toBeVisible();await p.getByRole('button',{name:'التصاميم الجاهزة',exact:true}).click();await expect(p.getByRole('button',{name:'فتح وتعديل',exact:true})).toHaveCount(1);
  check('server drafts persisted and isolated '+office,true);await ctx.close();
 }
 check('no browser JavaScript exceptions',errors.length===0);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({environment:'local real Worker + in-memory Firestore/Firebase auth stub; no live external services',checks,errors},null,2));
}finally{await browser.close();h.server.close();}
