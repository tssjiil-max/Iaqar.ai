import {test,expect} from '@playwright/test';
import {startOfficeOsHarness,OFFICE_A,OWNER_A} from './server.mjs';
let harness;
test.beforeAll(async()=>{harness=await startOfficeOsHarness()});
test.afterAll(async()=>{harness.server.close()});
for(const width of [320,390,1280]){
 for(const route of ['scout/new','settings','settings/profile','settings/notifications','tools/calculator','record/new?kind=OFFER']){
  test(`${route} shared composition ${width}`,async({page})=>{
   await page.setViewportSize({width,height:900});
   await page.addInitScript(([u,o])=>{localStorage.setItem('harness.uid',u);localStorage.setItem('iaqar.officeId',o)},[OWNER_A,OFFICE_A]);
   await page.goto(`${harness.origin}/#/${route}`);await page.locator('[data-ui="page-header"]').waitFor();await page.evaluate(()=>document.fonts.ready);
   await expect(page.locator('[data-ui="page-header"]')).toHaveScreenshot(`${route.replaceAll('/','-').replaceAll('?','-')}-${width}-header.png`);
   if(route==='settings'){
    await page.locator('[data-settings="scout"]').waitFor();
    await expect(page.locator('.os-settings-grid')).toHaveScreenshot(`settings-${width}-tiles.png`);
   }
  });
 }
 test(`shared sheet heading ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.addInitScript(([u,o])=>{localStorage.setItem('harness.uid',u);localStorage.setItem('iaqar.officeId',o)},[OWNER_A,OFFICE_A]);
  await page.goto(`${harness.origin}/#/repo`);await page.getByRole('button',{name:'إضافة سجل جديد',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.os-sheet')).toHaveScreenshot(`record-sheet-${width}.png`);
 });
}
test('duplicate record warning keeps every action visible at 320px',async({page})=>{
 await page.setViewportSize({width:320,height:900});await page.goto(harness.origin);
 await page.evaluate(async()=>{
  const {h,ic,feedback,surface}=await import('/os/core/dom.js');
  const links=[1,2,3].map(n=>h('button',{class:'os-link-btn',type:'button',text:`عرض شقة في العزيزية ${n}`}));
  const warning=feedback({class:'os-alert warn','data-duplicate-warning':''},ic('alert'),'يشبه سجلًا موجودًا في مكتبك: ',...links);
  const card=surface('article',{class:'os-card os-quick-card'},warning);
  document.getElementById('app').replaceChildren(h('main',{class:'os-app'},card));
 });
 await page.evaluate(()=>document.fonts.ready);
 const bounds=await page.locator('[data-duplicate-warning] button').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
 expect(bounds.length).toBe(3);expect(bounds.every(b=>b.left>=0&&b.right<=320)).toBeTruthy();
 await expect(page.locator('[data-duplicate-warning]')).toHaveScreenshot('duplicate-warning-320.png');
});
