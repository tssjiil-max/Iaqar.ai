import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.OUT_DIR||'/tmp/iaqar-public-tour-qa';await mkdir(out,{recursive:true});
const marketingSha='775ac67f91cf78916cf56120ed206f83e008a3e3';
const types={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');let p=decodeURIComponent(url.pathname);
 try{
  if(p==='/__marketing'){
   res.setHeader('content-type','text/html');res.end(`<html dir="rtl"><meta charset="utf-8"><link rel="stylesheet" href="/os/os.css"><canvas id="design"></canvas><script type="module">import {drawMarketing} from '/__marketing/core/marketing-renderer.js'; import {makeDraft} from '/__marketing/domain/marketing-domain.js'; await drawMarketing(document.querySelector('canvas'),{name:'مكتب تجريبي — نموذج توضيحي',city:'المدينة المنورة',color:'#03677A',phone:'',link:'example.invalid/demo',logoUrl:''},makeDraft({headline:'عندك عمارة في المدينة المنورة؟',body:['أرسل تفاصيلها عبر رابط مكتبنا','لنتابع فرص البيع معك'].join(String.fromCharCode(10)),template:'frame',size:'square',font:'plex',fontSize:52,textY:42}));document.body.dataset.ready='yes';</script></html>`);return;
  }
  if(p.startsWith('/__marketing/')){
   const name=p.replace('/__marketing/','');let data;
   if(['core/marketing-renderer.js','domain/marketing-domain.js'].includes(name))data=execFileSync('git',['show',`${marketingSha}:public/os/${name}`],{cwd:root});
   else data=await readFile(path.join(root,'public/os',name));
   res.setHeader('content-type','text/javascript');res.end(data);return;
  }
  if(p==='/__/firebase/init.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({projectId:'iaqar-ai-staging',measurementId:'G-BZ1BZ2H1JM'}));return;}
  if(p==='/')p='/index.html';
  if(!path.extname(p))p+='.html';
  const file=path.resolve(root,'public','.'+p);if(!file.startsWith(path.join(root,'public')+path.sep))throw new Error('path');
  res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.TOUR_BASE||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
let errors=[];const checks=[];
try{
 if(!process.env.TOUR_BASE && process.env.REGENERATE_MARKETING==='1'){
  const page=await browser.newPage();page.on('pageerror',e=>console.error('render:',e.message));page.on('response',r=>{if(r.status()>=400)console.error(r.status(),r.url());});await page.goto(`http://127.0.0.1:${server.address().port}/__marketing`);await page.waitForSelector('body[data-ready="yes"]',{state:'attached',timeout:15000}).catch(async e=>{console.error(await page.content());console.error(await page.evaluate(()=>({fonts:document.fonts.status,body:document.body?.outerHTML})));throw e;});
  const data=await page.locator('canvas').evaluate(el=>el.toDataURL('image/png'));await writeFile(path.join(root,'public/tour/marketing-demo.png'),Buffer.from(data.split(',')[1],'base64'));await page.close();
  execFileSync('python',['-c',"from PIL import Image; Image.open('public/tour/marketing-demo.png').save('public/tour/marketing-demo.webp',quality=85,method=6)"],{cwd:root});
 }
 for(const [width,height] of [[320,740],[390,844],[768,1024],[1440,1000]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});const page=await context.newPage();let nonLocal=[];
  page.on('pageerror',e=>errors.push(`${width}: ${e.message}`));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))nonLocal.push(r.url());});
  await page.goto(base+'/tour');await page.getByRole('button',{name:'شاهد ترتيب المثال',exact:true}).waitFor();await page.getByRole('button',{name:'بدون قياس',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
  await page.getByRole('link',{name:'شاهد كيف يعمل',exact:true}).click();
  await page.getByRole('button',{name:'شاهد ترتيب المثال',exact:true}).click();await page.getByText('2,000,000 ريال',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'تعبئة يدوية',exact:true}).click();assert.equal(await page.locator('#demo-panel input, #demo-panel textarea').count(),0);
  await page.getByRole('tab',{name:'2 شاهد المطابقة',exact:true}).click();assert.match(await page.locator('#demo-panel').innerText(),/الهجرة/);assert.match(await page.locator('#demo-panel').innerText(),/1,900,000/);
  await page.getByRole('tab',{name:'3 تواصل ومعاينة',exact:true}).click();await page.getByRole('button',{name:'شاهد رد الطرف',exact:true}).click();await page.getByText('رد توضيحي: العميل وافق على الموعد؛ المالك لم يرد بعد.',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'4 شاهد التفاوض',exact:true}).click();assert.equal(await page.locator('#demo-panel [data-room-part="agreed"]').count(),1);
  await page.getByRole('tab',{name:'4 شاهد التفاوض',exact:true}).press('Home');assert.equal(await page.getByRole('tab',{name:'1 إضافة طلب',exact:true}).getAttribute('aria-selected'),'true');
  const img=page.locator('.marketing-art img');await img.scrollIntoViewIfNeeded();await img.evaluate(el=>el.decode());assert.equal(await img.evaluate(el=>el.naturalWidth),1080);
  await page.screenshot({path:path.join(out,`marketing-${width}.png`)});
  await page.locator('#negotiation').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`room-${width}.png`)});
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,`home-${width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(nonLocal.length,0,`unexpected calls ${nonLocal}`);
  const body=await page.locator('body').innerText();assert.doesNotMatch(body,/05\d{8}|AIza|Bearer|@gmail/);
  assert.equal(await page.getByRole('link',{name:'أرغب في تجربة iAqar',exact:true}).getAttribute('href'),'/?tour=1#/register');
  checks.push({width,height,rtl:true,noOverflow:true,noPersonalData:true,noExternalRequests:true,demoSteps:true,marketingImage:true});await context.close();
 }
 assert.equal(errors.length,0,errors.join('\n'));
 await writeFile(path.join(out,'report.json'),JSON.stringify({base,checks,errors},null,2));console.log(JSON.stringify({base,checks,errors},null,2));
}finally{await browser.close();server.close();}
