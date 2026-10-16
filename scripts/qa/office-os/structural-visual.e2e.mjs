import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import { chromium } from 'playwright';
import { startOfficeOsHarness, OFFICE_A, OWNER_A, BROKER_A2 } from './server.mjs';
import { seedStates } from './seed.mjs';
const variant=process.env.VARIANT||'after';
const out=`qa/structural-visual/${variant}`;fs.mkdirSync(out,{recursive:true});
const harness=await startOfficeOsHarness();const seed=await seedStates(harness);
const screens=[
 ['office','office'],['tasks','tasks'],['repository','repo'],['task',`task/${seed.reviewTaskId}`],
 ['record',`record/${seed.review.offerId}`],['record-edit',`record/${seed.review.offerId}/edit`],['new-offer','record/new?kind=OFFER'],['new-request','record/new?kind=REQUEST'],['quick-add','quick-add'],
 ['review',`review/${seed.review.matchId}`],['journey',`journey/${seed.negotiation.journeyId}`],['viewing',`journey/${seed.viewingResult.journeyId}`],['deal',`deal/${seed.negotiation.journeyId}`],['session',`session/${seed.negotiation.journeyId}`],
 ['scout','scout'],['scout-new','scout/new'],['agent','agent'],['agent-try','agent/try'],['library','library'],['search','search'],['inbox','inbox'],['audit','audit'],['community','community'],
 ['search-results','search?q=الملقا'],['search-empty','search?q=ززززلايوجد'],
 ['new-offer-manual','record/new?kind=OFFER'],['new-request-manual','record/new?kind=REQUEST'],
 ...['calculator','forms','guide','services','market'].map(n=>[n,`tools/${n}`]),
 ['settings','settings'],...['profile','link','channels','cooperation','agent','scout','notifications','brokers'].map(n=>[`settings-${n}`,`settings/${n}`]),
 ['missing-record','record/missing-record'],['missing-review','review/missing-match'],['missing-journey','journey/missing-journey'],['missing-scout','scout/opp/so_missing0000'],
 ['broker-settings','settings/profile',BROKER_A2],['login','',false],['register','register',false],['public','/m/sultan',false],['public-owner','/m/sultan?kind=owner',false]
];
const originals=new Map();
const browser=await chromium.launch();const results=[],errors=[];
try{
 for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
  for(const [name,route,user=OWNER_A]of screens.filter(([name])=>!process.env.SCREEN||new RegExp(process.env.SCREEN).test(name))){
   const ctx=await browser.newContext({viewport:{width,height:900},locale:'ar-SA',reducedMotion:'reduce'});
   if(user)await ctx.addInitScript(([u,o])=>{localStorage.setItem('harness.uid',u);localStorage.setItem('iaqar.officeId',o)},[user,OFFICE_A]);
   if(variant==='before'||process.env.SOURCE_REF)await ctx.route('**/os/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(!originals.has(pathname)){try{originals.set(pathname,execFileSync('git',['show',`${process.env.SOURCE_REF||'d61f38e'}:public${pathname}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))}catch{originals.set(pathname,null)}}
    const body=originals.get(pathname);if(body!==null)await route.fulfill({contentType:pathname.endsWith('.css')?'text/css':'text/javascript',body});else await route.continue();
   });
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(`${name}/${width}: ${e.message}`));
   await page.goto(harness.origin+(route.startsWith('/')?route:`/#/${route}`));
   await page.locator('.os-app').waitFor();await page.waitForTimeout(300);await page.evaluate(()=>document.fonts.ready);
   if(name.endsWith('-manual')){await page.locator('[data-fill-mode="manual"]').click();await page.locator('input[name="propertyType"]').waitFor({state:'visible'});}
   if(name==='search-results')await page.locator('[data-search-group]').first().waitFor();
   if(name==='search-empty')await page.locator('.os-empty',{hasText:'لا توجد نتائج'}).waitFor();
   if(name==='public-owner'){await page.getByRole('button',{name:/لدي عقار/}).click();await page.locator('textarea').first().waitFor();}
   const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,headers:document.querySelectorAll('[data-ui="page-header"]').length,headings:document.querySelectorAll('.os-page-head').length,surfaces:document.querySelectorAll('[data-ui="surface"]').length,cards:document.querySelectorAll('.os-card').length,tiles:document.querySelectorAll('[data-ui="navigation-tile"]').length,rtl:document.documentElement.dir}));
   results.push({name,route,width,...metrics});
   await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});
   if(variant!=='before'&&!process.env.SOURCE_REF){
    assert.ok(metrics.overflow<=1,`${name}/${width} overflow ${metrics.overflow}`);
    assert.equal(metrics.rtl,'rtl');
    assert.equal(metrics.headers,metrics.headings,`${name} all page heads use shared composition`);
    if(name==='settings')assert.ok(metrics.tiles>=8,'settings uses office navigation tiles');
   }
   if(name==='repository'){
    await page.getByRole('button',{name:'إضافة سجل جديد',exact:true}).click();await page.locator('.os-sheet').waitFor();
    await page.screenshot({path:`${out}/add-sheet-${width}.png`,fullPage:true});
    if(variant==='after')assert.equal(await page.locator('.os-sheet [data-ui="dialog-heading"]').count(),1);
   }
   await ctx.close();
  }
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS ${results.length} screen/width checks (${variant})`);
}finally{
 const target=`${out}/results.json`;
 const previous=process.env.SCREEN&&fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')).results.filter(old=>!results.some(r=>r.name===old.name&&r.width===old.width)):[];
 fs.writeFileSync(target,JSON.stringify({variant,results:[...previous,...results],errors},null,2));
 await browser.close();harness.server.close();
}
