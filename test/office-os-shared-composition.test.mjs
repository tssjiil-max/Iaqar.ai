import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as dom from '../public/os/core/dom.js';
function setup(){const w=new JSDOM('<html dir="rtl"><body></body></html>').window;globalThis.document=w.document;globalThis.Node=w.Node;return w;}
test('page header keeps live title, back callback and reference action in named slots',()=>{
 setup();assert.equal(typeof dom.pageHeader,'function');let clicks=0;
 const back=dom.h('button',{onClick:()=>clicks++},'رجوع');const title=dom.h('h1',{class:'os-page-title',text:'إضافة عرض'});const action=dom.h('button',{'data-ref':'',text:'#123'});
 const header=dom.pageHeader(title,{backControl:back,action,iconName:'offers',description:'إدارة بيانات العقار'});
 assert.equal(header.dataset.ui,'page-header');assert.equal(header.querySelector('.os-page-heading .os-page-title'),title);
 assert.equal(header.querySelector('.os-page-toolbar').firstChild,back);assert.equal(header.querySelector('.os-page-actions').firstChild,action);
 title.textContent='إضافة طلب';assert.equal(header.querySelector('h1').textContent,'إضافة طلب');back.click();assert.equal(clicks,1);
 assert.equal(header.querySelector('.os-page-icon svg').getAttribute('aria-hidden'),'true');
});
test('page header handles literal untrusted text and omits empty action toolbar',()=>{
 setup();assert.equal(typeof dom.pageHeader,'function');const header=dom.pageHeader('<img src=x onerror=alert(1)>');
 assert.equal(header.querySelector('img'),null);assert.equal(header.querySelector('h1').textContent,'<img src=x onerror=alert(1)>');assert.equal(header.querySelector('.os-page-toolbar'),null);
});
test('shared surface preserves tag, attributes, hidden state and original child controls',()=>{
 setup();assert.equal(typeof dom.surface,'function');let calls=0;const child=dom.h('button',{onClick:()=>calls++},'حفظ');
 const card=dom.surface('section',{class:'os-card os-form',hidden:true,'data-record':'record-1'},child);
 assert.equal(card.tagName,'SECTION');assert.equal(card.dataset.ui,'surface');assert.equal(card.dataset.record,'record-1');assert.equal(card.hidden,true);assert.equal(card.firstChild,child);child.click();assert.equal(calls,1);
});
test('navigation tile matches office hierarchy and preserves navigation callback and data selectors',()=>{
 setup();assert.equal(typeof dom.navigationTile,'function');let opened=0;
 const tile=dom.navigationTile({title:'قنوات المكتب',hint:'واتساب وتيليجرام',iconName:'send',tone:'blue',attrs:{'data-settings':'channels'},onClick:()=>opened++});
 assert.equal(tile.type,'button');assert.equal(tile.dataset.settings,'channels');assert.equal(tile.querySelector('.ref-reference-copy strong').textContent,'قنوات المكتب');assert.equal(tile.querySelector('.ref-reference-copy small').textContent,'واتساب وتيليجرام');assert.ok(tile.querySelector('.ref-reference-icon svg'));tile.click();assert.equal(opened,1);
});
test('dialog heading exposes the same visual slots while retaining close control',()=>{
 setup();assert.equal(typeof dom.dialogHeading,'function');let closed=false;const heading=dom.dialogHeading('إضافة سجل جديد',()=>closed=true);
 assert.equal(heading.dataset.ui,'dialog-heading');assert.equal(heading.querySelector('h2').textContent,'إضافة سجل جديد');heading.querySelector('button[aria-label="إغلاق"]').click();assert.equal(closed,true);
});
test('standalone heading reuses original description node so live updates and ids survive',()=>{
 setup();const description=dom.h('p',{id:'adminUserLine',text:'مرحبًا'});const header=dom.pageHeader('إدارة المنصة',{description});
 assert.equal(header.querySelector('#adminUserLine'),description);description.textContent='مرحبًا سلطان';assert.equal(header.querySelector('p').textContent,'مرحبًا سلطان');
});
test('control groups keep tab semantics and original interactive children',()=>{
 setup();assert.equal(typeof dom.controlGroup,'function');const tab=dom.h('button',{'aria-pressed':'true',text:'العروض'});
 const group=dom.controlGroup('div',{class:'os-chips',role:'group','aria-label':'نوع السجل'},tab);
 assert.equal(group.dataset.ui,'control-group');assert.equal(group.getAttribute('aria-label'),'نوع السجل');assert.equal(group.firstChild,tab);assert.equal(tab.getAttribute('aria-pressed'),'true');
});
test('loading state announces progress and preserves requested dimensions and data selectors',()=>{
 setup();assert.equal(typeof dom.loadingState,'function');const el=dom.loadingState({style:{height:'60px'},'data-test-loading':''});
 assert.equal(el.getAttribute('role'),'status');assert.equal(el.getAttribute('aria-busy'),'true');assert.equal(el.style.height,'60px');assert.ok(el.querySelector('.os-loading-lines'));assert.equal(el.textContent,'جارٍ التحميل…');
});
test('feedback surface retains alert text updates, hidden state and tone styling',()=>{
 setup();assert.equal(typeof dom.feedback,'function');const alert=dom.feedback({class:'os-alert bad',hidden:true,role:'alert',text:'تعذر التحميل','data-error':''});
 assert.equal(alert.hidden,true);assert.equal(alert.getAttribute('role'),'alert');assert.equal(alert.textContent.trim(),'تعذر التحميل');alert.textContent='حاول مجددًا';assert.equal(alert.textContent,'حاول مجددًا');assert.ok(alert.classList.contains('bad'));
});
