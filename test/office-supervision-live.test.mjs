import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'https://office.test/#/office?layout=supervision'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,Node:dom.window.Node,HTMLElement:dom.window.HTMLElement,location:dom.window.location,localStorage:dom.window.localStorage});
const {session}=await import('../public/os/core/session.js');
const {state}=await import('../public/os/core/state.js');
const {renderOfficeSupervision}=await import('../public/os/views/office-supervision.js');
test('live office uses actual office profile and real record IDs, tabs stay in the page',()=>{
 Object.assign(session,{officeId:'office-a',user:{uid:'owner'},isManager:true,office:{officeName:'مكتب اختبار',brokerName:'وسيط اختبار',licenseNumber:'1200',specialties:['sale']}});
 Object.assign(state,{recordsReady:true,tasksReady:true,error:'',records:[{id:'real-request',kind:'REQUEST',propertyType:'شقة',purpose:'PURCHASE',city:'المدينة المنورة'}],tasks:[]});
 const root=document.querySelector('#root');const stop=renderOfficeSupervision(root);
 assert.match(root.textContent,/وسيط اختبار/);assert.match(root.textContent,/1200/);assert.match(root.textContent,/طلب/);
 const tabs=[...root.querySelectorAll('[role=tab]')];assert.equal(tabs.length,5);tabs[3].click();assert.equal(location.hash,'#/office?layout=supervision');assert.equal(root.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'),'supervision-tab-3');
 assert.match(root.textContent,/لا معاملات/);stop();
});
