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
 assert.ok(!r.body.results.some(x=>/private|sold/.test(x.reference)));assert.equal(r.body.contact,undefined,'search asks for no contact');
 const picked=await call('/os/public/search/select',{searchToken:r.body.searchToken,reference:r.body.results[0].reference,name:input.name,phone:input.phone,channel:input.channel,consentProcessing:true,consentContact:true});assert.equal(picked.status,200,JSON.stringify(picked.body));assert.equal(picked.body.contact.sent,false);
});
test('name, phone, communication channel and explicit consents are required on the server',async()=>{
 // Contact is collected when the client chooses a property (search itself needs none).
 const s=await call('/os/public/search',{...input,requestKey:'consent-rules-0001'});assert.equal(s.status,200,JSON.stringify(s.body));
 const base={searchToken:s.body.searchToken,reference:s.body.results[0].reference,name:input.name,phone:input.phone,channel:input.channel,consentProcessing:true,consentContact:true};
 for(const patch of [{name:''},{phone:'123'},{channel:'email'},{consentProcessing:false},{consentContact:false}]) assert.equal((await call('/os/public/search/select',{...base,...patch})).status,400,JSON.stringify(patch));
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
  const s=await call('/os/public/search',{...input,requestKey:'telegram-guest-test-0001'});
  const replaySearch=await call('/os/public/search',{...input,requestKey:'telegram-guest-test-0001'});assert.equal(replaySearch.body.searchToken,s.body.searchToken,'retries reuse the same session');
  // The Telegram link is handed out only after the client chose a property and consented.
  const r=await call('/os/public/search/select',{searchToken:s.body.searchToken,reference:s.body.results[0].reference,name:input.name,phone:input.phone,channel:'telegram',consentProcessing:true,consentContact:true});assert.equal(r.status,200,JSON.stringify(r.body));
  const token=new URL(r.body.contact.telegramLink).searchParams.get('start');assert.ok(token.startsWith('ps_'));
  const replay=await call('/os/public/search/select',{searchToken:s.body.searchToken,reference:s.body.results[0].reference,name:input.name,phone:input.phone,channel:'telegram',consentProcessing:true,consentContact:true});assert.equal(replay.body.contact.telegramLink,r.body.contact.telegramLink,'a repeated choice keeps the same link');
  const webhook=async (chat,secret='public-search-test-secret')=>{
   const response=await h.worker.fetch(new Request('https://worker.test/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({update_id:1234,message:{chat:{id:chat,type:'private'},from:{id:chat},text:`/start ${token}`}})}),h.env,{waitUntil(){}});return response;
  };
  assert.equal((await webhook(777,'wrong-secret')).status,401);assert.equal(sent.length,0);
  assert.equal((await webhook(777)).status,200);assert.equal(sent.length,1);assert.match(sent[0].text,/نتائج طلبك العقاري/);
  await webhook(777);await webhook(888);assert.equal(sent.length,1);
  assert.ok(!sent[0].text.includes('0551234567'));
 } finally {globalThis.fetch=original;}
});

test('guest UI: search without contact, choose a result, consent in the sheet, then the WhatsApp handoff',async()=>{
 const {JSDOM}=await import('jsdom');
 const dom=new JSDOM('<!doctype html><html dir="rtl"><body><div id="root"></div></body></html>',{url:'https://worker.test/?view=search'});
 const globals=['window','document','Node','requestAnimationFrame'];const previous=Object.fromEntries(globals.map(k=>[k,globalThis[k]]));for(const k of globals)globalThis[k]=k==='requestAnimationFrame'?(fn)=>setTimeout(fn,0):dom.window[k];
 dom.window.IAQAR={workerBase:'https://worker.test'};dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const fetchDouble=globalThis.fetch;globalThis.fetch=async(url,options)=>String(url).startsWith('https://worker.test/os/')?h.worker.fetch(new Request(String(url),options),h.env,{waitUntil(){}}):fetchDouble(url,options);
 const until=async(test)=>{for(let i=0;i<200&&!test();i++)await new Promise(resolve=>setTimeout(resolve,5));};
 try{
  const {publicSearchForm}=await import('../public/os/views/public-search.js');const root=document.querySelector('#root');root.append(publicSearchForm({id:OFFICE_A,city:'الرياض'}));
  assert.equal(root.querySelector('[name=scope]').value,'office');
  assert.equal(root.querySelector('[name=contactPhone]'),null,'no phone is asked before a choice');
  root.querySelector('[name=description]').value='مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف';
  root.querySelector('[data-guest-analyze]').click();
  await until(()=>root.querySelector('[name=price]').value);
  assert.equal(root.querySelector('[name=price]').value,'550000');assert.equal(root.querySelector('[name=propertyType]').value,'شقة');
  await until(()=>root.querySelector('[data-search-result]'));
  assert.equal(root.querySelector('[data-search-criteria]').open,false,'details remain collapsed after automatic search');
  assert.equal(root.querySelectorAll('[data-search-result]').length,3);assert.ok(!root.textContent.includes('0551234567'));
  assert.ok(root.querySelector('[data-status-label]').textContent.length>0,'each result shows its status');
  root.querySelector('[data-choose-result]').click();
  const sheet=document.querySelector('[data-guest-select-form]');assert.ok(sheet,'choosing opens the contact sheet');
  sheet.querySelector('[name=contactName]').value='عميل واجهة';sheet.querySelector('[name=contactPhone]').value='0557000333';
  sheet.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(document.querySelector('[data-whatsapp-handoff]'),null,'no handoff without both consents');
  sheet.querySelector('[name=consentProcessing]').checked=true;sheet.querySelector('[name=consentContact]').checked=true;
  sheet.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>document.querySelector('[data-whatsapp-handoff]'));
  const href=new URL(document.querySelector('[data-whatsapp-handoff]').getAttribute('href'));
  assert.equal(href.hostname,'wa.me');assert.equal(href.pathname,'/966501111111');
  assert.ok(document.querySelector('[data-guest-outcome]').textContent.includes('لم نرسل شيئًا نيابة عنك'));
 }finally{globalThis.fetch=fetchDouble;for(const k of globals)if(previous[k]===undefined)delete globalThis[k];else globalThis[k]=previous[k];dom.window.close();}
});

test('guest results respect the entered budget and do not imply an owner approved a discount',async()=>{
 h.store.seed(`offices/${OFFICE_A}/opportunities/over-budget`,{...offer,district:'العقيق',priceOrBudget:560000,salePrice:560000,priceStatus:'FIXED'});
 const r=await call('/os/public/search',{...input,requestKey:'strict-budget-test-0001',criteria:{...input.criteria,district:'العقيق'}});
 assert.equal(r.status,200);assert.equal(r.body.results.length,0);
});
