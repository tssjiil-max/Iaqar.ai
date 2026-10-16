import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startOfficeOsHarness} from './server.mjs';
const variant=process.env.VARIANT||'after';const out=`qa/structural-visual/${variant}`;fs.mkdirSync(out,{recursive:true});
const h=await startOfficeOsHarness();const browser=await chromium.launch();const results=[];
try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:900},locale:'ar-SA'});const page=await context.newPage();
 for(const file of ['complete.html','admin/index.html','scout-inbox.html','legacy.html']){
  await page.goto(`${h.origin}/${file}`);await page.waitForTimeout(250);await page.evaluate(()=>document.fonts.ready);
  const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,headers:document.querySelectorAll('[data-ui="page-header"]').length,rtl:document.documentElement.dir}));
  await page.screenshot({path:`${out}/standalone-${file.replaceAll('/','-')}-${width}.png`,fullPage:true});
  if(variant!=='before'){assert.ok(m.headers>0,file+' shared header');assert.ok(m.overflow<=1,`${file}/${width} overflow ${m.overflow}`);}
  results.push({file,width,...m});
 }
 await context.close();
}fs.writeFileSync(`${out}/standalone-results.json`,JSON.stringify({results},null,2));console.log(`PASS ${results.length} standalone structural screenshots`);
}finally{await browser.close();h.server.close()}
