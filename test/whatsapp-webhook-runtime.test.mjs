import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startOfficeOsHarness, OFFICE_A, OWNER_A, OWNER_B, idTokenFor } from '../scripts/qa/office-os/server.mjs';
const h=await startOfficeOsHarness();test.after(()=>h.server.close());
const originalProject=h.env.FIREBASE_PROJECT_ID;
Object.assign(h.env,{META_APP_SECRET:'local-hmac-secret',META_WEBHOOK_VERIFY_TOKEN:'local-verify',FIREBASE_PROJECT_ID:'iaqar-ai-staging',WHATSAPP_AGENT_ENABLED:'enabled',WHATSAPP_AGENT_OFFICE_IDS:OFFICE_A,WHATSAPP_AGENT_SEND:'enabled',WHATSAPP_AGENT_ALLOWED_RECIPIENTS:'966500000001',ANTHROPIC_API_KEY:'test-secret',ANTHROPIC_MODEL:'test-model',WHATSAPP_AGENT_CLASSIFIER:'claude',META_WHATSAPP_ACCESS_TOKEN:'test-token'});
h.store.seed('whatsapp_accounts/runtime-phone',{officeId:OFFICE_A,wabaId:'runtime-waba',status:'connected',isOnBizApp:true,platformType:'CLOUD_API',metaPhoneStatus:'CONNECTED'});
h.store.seed(`offices/${OFFICE_A}/integrations/whatsapp`,{autoReplyEnabled:true});
const upstream=globalThis.fetch,calls=[];let release;
const gate=new Promise(r=>{release=r;});
globalThis.fetch=async(input,init={})=>{
 const u=input instanceof URL?input.href:typeof input==='string'?input:input.url;
 if(String(u).startsWith('https://api.anthropic.com/')){calls.push('claude');await gate;return Response.json({content:[{type:'text',text:'{"intent":"purchase"}'}]});}
 if(String(u).startsWith('https://graph.facebook.com/')){calls.push('meta');return Response.json({messages:[{id:'runtime-outbound'}]});}
 if(String(u).startsWith('https://firestore.googleapis.com/')) return upstream(String(u).replace('/projects/iaqar-ai-staging/','/projects/'+originalProject+'/'),init);
 return upstream(input,init);
};
test.after(()=>{globalThis.fetch=upstream;release();});
const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'runtime-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:'runtime-phone'},messages:[{id:'runtime-inbound',from:'966500000001',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'أبحث عن شقة'}}]}}]}]});
function signed(secret=h.env.META_APP_SECRET){return new Request('https://worker.test/meta/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')},body});}
test('Meta GET verify token and POST invalid signature are handled before work is queued',async()=>{
 const good=await h.worker.fetch(new Request('https://worker.test/meta/webhook?hub.mode=subscribe&hub.verify_token=local-verify&hub.challenge=123'),h.env,{});assert.equal(good.status,200);assert.equal(await good.text(),'123');
 const badGet=await h.worker.fetch(new Request('https://worker.test/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong'),h.env,{});assert.equal(badGet.status,403);
 const bad=await h.worker.fetch(signed('wrong'),h.env,{});assert.equal(bad.status,401);assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`).length,0);assert.equal(calls.length,0);
});
test('real Worker acknowledges persisted work while Claude is pending, then sends once in background',async()=>{
 const pending=[];
 const r=await h.worker.fetch(signed(),h.env,{waitUntil(p){pending.push(p);}});assert.equal(r.status,200);assert.equal((await r.json()).received,1);assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`).length,1);assert.ok(!calls.includes('meta'));
 release();await Promise.all(pending);assert.deepEqual(calls,['claude','meta']);assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`)[0].waQueueState,'SENT');
 const replay=await h.worker.fetch(signed(),h.env,{waitUntil(p){pending.push(p);}});assert.equal((await replay.json()).received,0);await Promise.all(pending);assert.deepEqual(calls,['claude','meta']);
});
test('status and stop routes require office membership and manager authority',async()=>{
 h.env.FIREBASE_PROJECT_ID=originalProject;
 const call=async(uid,route)=>h.worker.fetch(new Request(`https://worker.test${route}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${idTokenFor(uid)}`},body:JSON.stringify({officeId:OFFICE_A,enabled:false})}),h.env,{});
 assert.equal((await call(OWNER_B,'/os/whatsapp-agent/status')).status,403);
 assert.equal((await call(OWNER_A,'/os/whatsapp-agent/status')).status,200);
 assert.equal((await call(OWNER_A,'/os/whatsapp-agent/settings')).status,200);
 assert.equal(h.store.get('whatsapp_accounts/runtime-phone').status,'connected');
});
test('enabling a pilot office keeps legacy intake working for every other office',async()=>{
 h.env.FIREBASE_PROJECT_ID='iaqar-ai-staging';h.store.seed('whatsapp_accounts/legacy-phone',{officeId:'office-legacy',wabaId:'legacy-waba',status:'connected'});
 const legacy=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'legacy-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:'legacy-phone'},messages:[{id:'legacy-message',from:'966500000002',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'السلام عليكم'}}]}}]}]});
 const r=await h.worker.fetch(new Request('https://worker.test/meta/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',h.env.META_APP_SECRET).update(legacy).digest('hex')},body:legacy}),h.env,{});
 assert.equal(r.status,200);assert.equal(h.store.list('offices/office-legacy/inbox').length,1);
});
