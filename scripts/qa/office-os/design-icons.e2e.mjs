// Blue identity on the work-first office: synthetic data and local network only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startOfficeOsHarness } from './server.mjs';
import { seedStates } from './seed.mjs';
const out = process.env.OUT_DIR || '/tmp/iaqar-blue-identity';
await fs.mkdir(out, {recursive:true});
const h = await startOfficeOsHarness(); await seedStates(h);
const browser = await chromium.launch();
const nav = [['office','office'],['repo','dashboard'],['deals','favorite'],['inbox','chat'],['more','services']];
try {
  for (const width of [320,390,768,1280]) {
    const context = await browser.newContext({viewport:{width,height:900},locale:'ar-SA',serviceWorkers:'block'});
    await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
    const page = await context.newPage(); const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(h.origin);
    await page.locator('[name="phone"]').fill('0501111111');
    await page.locator('[name="password"]').fill('pass-a');
    await page.getByRole('button',{name:'دخول المكتب',exact:true}).click();
    await page.locator('[data-smart-office]').waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.ref-bottom img.os-ico3d')].length===5 && [...document.querySelectorAll('.ref-bottom img.os-ico3d')].every(i=>i.complete && i.naturalWidth>0));
    assert.deepEqual(await page.locator('.ref-bottom img.os-ico3d').evaluateAll(els=>els.map(i=>i.dataset.icon3d)),nav.map(([,key])=>key));
    const brand = await page.evaluate(async()=>{
      const logo=document.querySelector('.ref-logo'); const bg=getComputedStyle(logo).backgroundImage;
      const src=(bg.match(/url\(["']?([^"')]+)/)||[])[1];
      const loaded=await new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth>0);i.onerror=()=>resolve(false);i.src=src;});
      return {bg,loaded,primary:getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toLowerCase()};
    });
    assert.match(brand.bg,/iaqar-logo-3d.webp/); assert.equal(brand.loaded,true); assert.equal(brand.primary,'#1668e3');
    await page.screenshot({path:`${out}/office-${width}.png`,fullPage:true});
    for(const [route] of nav){
      await page.locator(`.ref-bottom [data-tool-route="${route}"]`).click();
      await page.waitForURL(`**/#/${route}`);
      await page.locator(`.ref-bottom [data-tool-route="${route}"][aria-current="page"]`).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    assert.deepEqual(errors,[]);await context.close();
  }
} finally {await browser.close();await new Promise(r=>h.server.close(r));}
console.log('Blue logo, palette, five 3D navigation icons and routes passed at four widths');
