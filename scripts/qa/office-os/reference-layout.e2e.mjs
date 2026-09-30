import fs from 'node:fs';
import { chromium } from 'playwright';
import { startOfficeOsHarness, OFFICE_A, OWNER_A } from './server.mjs';
import { seedStates } from './seed.mjs';
const out='qa/office-os/new-reference';fs.mkdirSync(out,{recursive:true});
const h=await startOfficeOsHarness();const seed=await seedStates(h);
// Reference photos and short names are isolated preview fixtures, never live records.
const source=fs.readFileSync('public/os/reference-assets/office-source.png').toString('base64');
const propertySvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="670 631 135 123"><image width="864" height="1536" href="data:image/png;base64,${source}"/></svg>`;
for(const record of h.store.list(`offices/${OFFICE_A}/opportunities`))h.store.seed(`offices/${OFFICE_A}/opportunities/${record.id}`,{...record,coverUrl:h.origin+'/preview-property.svg',contactName:record.opportunityKind==='REQUEST'?'أحمد الشهري':'سلطان الصاعدي'});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,locale:'ar-SA'});
await context.addInitScript(([uid,office])=>{localStorage.setItem('harness.uid',uid);localStorage.setItem('iaqar.officeId',office);},[OWNER_A,OFFICE_A]);
await context.route('**/preview-property.svg',route=>route.fulfill({contentType:'image/svg+xml',body:propertySvg}));
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];
try{
 await page.goto(h.origin);await page.locator('.ref-home-row').first().waitFor();
 for(const width of [320,360,375,390,412,430]){
  await page.setViewportSize({width,height:844});
  for(const [name,hash,selector] of [['office','office','.ref-home-row'],['tasks','tasks','.ref-task-card'],['records','repo','.ref-record-card'],['detail','task/'+seed.reviewTaskId,'.ref-detail-step']]){
   await page.goto(h.origin+'/#/'+hash);await page.locator(selector).first().waitFor();await page.evaluate(()=>document.fonts.ready);
   const sizes=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
   if(sizes.scroll>width)throw Error('Overflow '+name+' '+width+' '+sizes.scroll);
   checks.push({name,width,overflow:false});
   if(width===390)await page.screenshot({path:out+'/'+name+'.png',fullPage:name==='detail'});
  }
 }
 await page.goto(h.origin+'/#/task/'+seed.reviewTaskId);for(const label of ['نوع المهمة','حالة المهمة','المرحلة الحالية','المطلوب منك الآن'])await page.locator('.ref-detail-facts').getByText(label,{exact:true}).waitFor();
 if(await page.locator('.ref-detail-facts ~ button, .ref-follow').count()!==1)throw Error('task detail must have exactly one main button');
 await page.getByRole('button',{name:'مراجعة المطابقة',exact:true}).click();await page.waitForURL('**/#/review/**');checks.push({name:'Task follow opens existing match review',ok:true});
 await page.goto(h.origin+'/#/repo');await page.getByRole('button',{name:'إضافة سجل جديد',exact:true}).click();
 await page.getByRole('button',{name:'إضافة عرض',exact:true}).click();await page.waitForURL('**/#/record/new?kind=OFFER');await page.locator('.os-sheet').waitFor({state:'hidden'});
 checks.push({name:'Add offer opens working form and closes chooser',ok:true});
 checks.push({name:'Repository add opens record type chooser',ok:true});
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));console.log('PASS',checks.length,'checks');
}finally{await browser.close();h.server.close();}
