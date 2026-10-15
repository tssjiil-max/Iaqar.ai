import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {startOfficeOsHarness,OFFICE_A,OWNER_A} from './server.mjs';
import {seedStates} from './seed.mjs';
const h=await startOfficeOsHarness();const seeded=await seedStates(h);
const browser=await chromium.launch();const out='qa/site-theme';fs.mkdirSync(out,{recursive:true});const errors=[],results=[];
const screens=[['office','/#/office'],['tasks','/#/tasks'],['repository','/#/repo'],['matching',`/#/review/${seeded.review.matchId}`],['journey',`/#/journey/${seeded.negotiation.journeyId}`],['record',`/#/record/${seeded.review.offerId}`],['new-record','/#/record/new?kind=OFFER'],['scout','/#/scout'],['scout-new','/#/scout/new'],['agent','/#/agent'],['library','/#/library'],['search','/#/search'],['inbox','/#/inbox'],['community','/#/community'],['calculator','/#/tools/calculator'],['forms','/#/tools/forms'],['guide','/#/tools/guide'],['services','/#/tools/services'],['market','/#/tools/market'],['settings','/#/settings'],['profile','/#/settings/profile'],['channels','/#/settings/channels'],['notifications','/#/settings/notifications'],['public','/m/sultan',false],['login','/',false],['register','/#/register',false],['reply',`/r#${seeded.negotiation.ownerReplyToken}`,false]];
try{for(const width of [360,390,430,768,1280])for(const [name,url,auth=true]of screens){
const ctx=await browser.newContext({viewport:{width,height:844},locale:'ar-SA'});
if(auth)await ctx.addInitScript(([u,o])=>{localStorage.setItem('harness.uid',u);localStorage.setItem('iaqar.officeId',o)},[OWNER_A,OFFICE_A]);
const page=await ctx.newPage();page.on('pageerror',e=>errors.push(name+': '+e.message));
await page.goto(h.origin+url);await page.locator('.os-app').waitFor();await page.waitForTimeout(180);await page.evaluate(()=>document.fonts.ready);
if(name==='office')assert.equal(await page.getByRole('button',{name:'تغيير الصورة',exact:true}).count(),0,'photo overlay must be removed');
const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,rtl:document.documentElement.dir,font:getComputedStyle(document.querySelector('.os-app')).fontFamily,header:document.querySelectorAll('.ref-reference-header').length,nav:document.querySelectorAll('.ref-reference-bottom').length,active:document.querySelectorAll('.ref-reference-bottom [aria-current="page"]').length,activeIcon:document.querySelector('.ref-reference-bottom [aria-current="page"] svg')?getComputedStyle(document.querySelector('.ref-reference-bottom [aria-current="page"] svg')).color:null,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length}));
assert.ok(metrics.overflow<=1,`${name}/${width} overflow ${metrics.overflow}`);assert.equal(metrics.rtl,'rtl');assert.match(metrics.font,/Office Tajawal/);assert.equal(metrics.broken,0,`${name} broken images`);
if(auth){assert.equal(metrics.header,1,name+' shared header');assert.equal(metrics.nav,1,name+' shared navigation');assert.equal(metrics.active,1,name+' active item');assert.equal(metrics.activeIcon,'rgb(255, 255, 255)',name+' active icon contrast');}
if(width===390||name==='tasks')await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});
results.push({name,width,...metrics});console.log(`checked ${name}/${width}`);await ctx.close();
}assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));console.log(`PASS ${results.length} screen/width checks`);
}finally{await browser.close();h.server.close()}
