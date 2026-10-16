import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B, OWNER_A, BROKER_A2, idTokenFor } from '../scripts/qa/office-os/server.mjs';
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const offer = { officeId: OFFICE_A, opportunityKind: 'OFFER', purpose: 'SALE', transactionType: 'sale', propertyType: 'شقة', city: 'الرياض', district: 'الملقا', priceOrBudget: 500000, salePrice: 500000, advertiserRole: 'OWNER', contactPhone: '0551234567', contactName: 'مالك سري', notes: 'كود الباب 1234', lifecycleStatus: 'ACTIVE', publicSearchVisible: true, rooms: 4, version: 1 };
for(let i=0;i<12;i++) h.store.seed(`offices/${OFFICE_A}/opportunities/pub-${i}`, {...offer,propertyId:`p${i}`});
h.store.seed(`offices/${OFFICE_A}/opportunities/private`, {...offer, publicSearchVisible:false});
h.store.seed(`offices/${OFFICE_A}/opportunities/sold`, {...offer, availabilityStatus:'SOLD'});
h.store.seed(`offices/${OFFICE_B}/opportunities/public-b`, {...offer, officeId:OFFICE_B, dataCompleteness:100, directOwner:true, availabilityConfirmed:true, priceConfirmed:true});
const input = { officeId: OFFICE_A, scope:'office', requestKey:'public-search-test-0001', criteria:{purpose:'PURCHASE',propertyType:'شقة',city:'الرياض',district:'الملقا',price:550000,rooms:4}, name:'عميل تجريبي',phone:'0557000111',channel:'telegram',consentProcessing:true,consentContact:true };
async function call(route,body,uid=''){
 const r=await h.worker.fetch(new Request(`https://worker.test${route}`,{method:'POST',headers:{'content-type':'application/json',...(uid?{authorization:`Bearer ${idTokenFor(uid)}`}:{})},body:JSON.stringify(body)}),h.env,{waitUntil(){}});return {status:r.status,body:await r.json()};
}
test('guest searches without login and gets only ten explicitly public offers with no owner data',async()=>{
 const r=await call('/os/public/search',input);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.results.length,10);
 assert.ok(r.body.results.every(x=>x.officeId===OFFICE_A));assert.equal(r.body.orchestration.event,'SEARCH_REQUESTED');
 assert.ok(!JSON.stringify(r.body).includes('0551234567'));assert.ok(!JSON.stringify(r.body).includes('مالك سري'));assert.ok(!JSON.stringify(r.body).includes('كود الباب'));
 assert.ok(!r.body.results.some(x=>/private|sold/.test(x.reference)));assert.equal(r.body.contact.sent,false);
});
test('name, phone, communication channel and explicit consents are required on the server',async()=>{
 for(const patch of [{name:''},{phone:'123'},{channel:'email'},{consentProcessing:false},{consentContact:false}]) assert.equal((await call('/os/public/search',{...input,...patch})).status,400);
});
test('all offices search still only returns explicitly public data',async()=>{
 const r=await call('/os/public/search',{...input,scope:'all',requestKey:'all-search-test-0001'});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.ok(r.body.results.some(x=>x.officeId===OFFICE_B));
});
test('unknown office cannot read inventory and a malformed scope is rejected',async()=>{
 assert.equal((await call('/os/public/search',{...input,officeId:'missing-office'})).status,404);
 assert.equal((await call('/os/public/search',{...input,scope:'anything'})).status,400);
});
test('public search analysis accepts pasted Arabic requests without registration',async()=>{
 const r=await call('/os/public/search/analyze',{officeId:OFFICE_A,text:'مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.listings[0].propertyType,'شقة');assert.equal(r.body.listings[0].price,550000);
});
test('publishing offers is an explicit office manager action',async()=>{
 const record={kind:'OFFER',purpose:'SALE',propertyType:'شقة',city:'الرياض',district:'الملقا',price:500000,contactPhone:'0555551234',publicSearchVisible:true};
 assert.equal((await call('/os/records/save',{officeId:OFFICE_A,record,requestKey:'publish-denied'},BROKER_A2)).status,403);
 const r=await call('/os/records/save',{officeId:OFFICE_A,record,requestKey:'publish-allowed'},OWNER_A);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.recordId}`).publicSearchVisible,true);
});

test('Telegram starts from an expiring guest link, sends through the real adapter only once and ignores a different chat',async()=>{
 Object.assign(h.env,{TELEGRAM_BOT_TOKEN:'123456789:public-search-test-token',TELEGRAM_WEBHOOK_SECRET:'public-search-test-secret',TELEGRAM_BOT_USERNAME:'iaqar_test_bot',TELEGRAM_OUTBOUND:'enabled'});
 const sent=[],original=globalThis.fetch;
 globalThis.fetch=async (url,init)=>String(url).startsWith('https://api.telegram.org/')?(sent.push(JSON.parse(init.body)),new Response(JSON.stringify({ok:true,result:{message_id:700}}),{status:200})):original(url,init);
 try {
  const r=await call('/os/public/search',{...input,requestKey:'telegram-guest-test-0001'});
  const token=new URL(r.body.contact.telegramLink).searchParams.get('start');assert.ok(token.startsWith('ps_'));
  const replay=await call('/os/public/search',{...input,requestKey:'telegram-guest-test-0001'});assert.equal(replay.body.contact.telegramLink,r.body.contact.telegramLink,'retries reuse the same session');
  const webhook=async (chat,secret='public-search-test-secret')=>{
   const response=await h.worker.fetch(new Request('https://worker.test/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:1234,message:{chat:{id:chat,type:'private'},from:{id:chat},text:`/start ${token}`}})}),h.env,{waitUntil(){}});return response;
  };
  assert.equal((await webhook(777,'wrong-secret')).status,401);assert.equal(sent.length,0);
  assert.equal((await webhook(777)).status,200);assert.equal(sent.length,1);assert.match(sent[0].text,/نتائج طلبك العقاري/);
  await webhook(777);await webhook(888);assert.equal(sent.length,1);
  assert.ok(!sent[0].text.includes('0551234567'));
 } finally {globalThis.fetch=original;}
});

test('guest UI extracts criteria, requires contact and renders real results without a login session',async()=>{
 const {JSDOM}=await import('jsdom');
 const dom=new JSDOM('<!doctype html><html dir="rtl"><body><div id="root"></div></body></html>',{url:'https://worker.test/?view=search'});
 const globals=['window','document','Node'];const previous=Object.fromEntries(globals.map(k=>[k,globalThis[k]]));for(const k of globals)globalThis[k]=dom.window[k];
 dom.window.IAQAR={workerBase:'https://worker.test'};dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const fetchDouble=globalThis.fetch;globalThis.fetch=async(url,options)=>String(url).startsWith('https://worker.test/os/')?h.worker.fetch(new Request(String(url),options),h.env,{waitUntil(){}}):fetchDouble(url,options);
 try{
  const {publicSearchForm}=await import('../public/os/views/public-search.js');const root=document.querySelector('#root');root.append(publicSearchForm({id:OFFICE_A,city:'الرياض'}));
  assert.equal(root.querySelector('[name=scope]').value,'office');
  root.querySelector('[name=description]').value='مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف';
  root.querySelector('[data-guest-analyze]').click();
  for(let i=0;i<100&&!root.querySelector('[name=price]').value;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(root.querySelector('[name=price]').value,'550000');assert.equal(root.querySelector('[name=propertyType]').value,'شقة');
  root.querySelector('[name=contactName]').value='عميل واجهة';root.querySelector('[name=contactPhone]').value='0557000333';root.querySelector('[name=channel]').value='whatsapp';root.querySelector('[name=consentProcessing]').checked=true;root.querySelector('[name=consentContact]').checked=true;
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<100&&!root.querySelector('[data-search-result]');i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(root.querySelectorAll('[data-search-result]').length,10);assert.ok(root.textContent.includes('الإرسال الآلي لهذه القناة غير مفعّل'));assert.ok(!root.textContent.includes('0551234567'));
 }finally{globalThis.fetch=fetchDouble;for(const k of globals)if(previous[k]===undefined)delete globalThis[k];else globalThis[k]=previous[k];dom.window.close();}
});
