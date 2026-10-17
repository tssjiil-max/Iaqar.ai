import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startOfficeOsHarness} from './server.mjs';
const harness=await startOfficeOsHarness();const browser=await chromium.launch();
const out='qa/structural-visual/legacy-settings-after';fs.mkdirSync(out,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:900}});
 await page.addInitScript(()=>localStorage.setItem('harness.uid','uid-owner-a'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${harness.origin}/legacy.html?office=office-alpha`);await page.waitForTimeout(1500);
 console.log(await page.evaluate(()=>({title:document.title,settings:document.getElementById('officeSettings')?.hidden,buttons:[...document.querySelectorAll('button')].filter(b=>/إعدادات/.test(b.textContent)).map(b=>({id:b.id,text:b.textContent.slice(0,60)})),sections:document.querySelectorAll('[data-office-section-mounted]').length,errors:document.getElementById('accessGate')?.textContent.slice(0,200)})));
 console.log('PAGE ERRORS',errors);
 await page.locator('#officeSettingsBtn').click({timeout:5000});
 await page.locator('#officeProfileForm').waitFor({state:'visible',timeout:5000});
 await page.screenshot({path:`${out}/initial.png`,fullPage:true});
}finally{await browser.close();harness.server.close();}
