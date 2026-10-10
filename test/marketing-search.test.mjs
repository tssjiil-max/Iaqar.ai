import test from 'node:test';import assert from 'node:assert/strict';
import { marketingAction,searchMarketing } from '../worker/src/office-os/marketing-service.js';
const rows=new Map();let now=new Date('2026-10-10T12:00:00Z');
const ctx={officeId:'alpha',appOrigin:'https://office.example',env:{DEPLOYMENT_ENV:'staging'},now:()=>now,deps:{appError:(code,status,publicMessage)=>Object.assign(new Error(publicMessage),{code,status,publicMessage})},store:{
 async get(p){return rows.get(p.join('/'))||null;},async create(p,v){const k=p.join('/');if(rows.has(k))return false;rows.set(k,structuredClone(v));return true;},async update(p,fn){const k=p.join('/');const current=structuredClone(rows.get(k));const patch=await fn(current);const next={...current,...patch};rows.set(k,next);return {current,patch,next};}
}};
rows.set('offices/alpha',{officeName:'مكتب ألفا',publicSlug:'alpha',city:'المدينة'});const actor={uid:'u1',isManager:true};
let url='https://example.com/channel/'+('a'.repeat(110));
const realFetch=globalThis.fetch;test.after(()=>{globalThis.fetch=realFetch;});
test('unconfigured search returns no invented opportunities',async()=>{const r=await searchMarketing(ctx,'q');assert.equal(r.status,'requires_configuration');assert.deepEqual(r.results,[]);});
test('search uses only fixed API endpoint, refuses internal URLs and returns sourced unknown terms',async()=>{
 ctx.env.BRAVE_SEARCH_API_KEY='TEST-KEY';globalThis.fetch=async(input,init)=>{assert.match(input,/^https:\/\/api.search.brave.com\/res\/v1\/web\/search\?/);assert.equal(init.headers['X-Subscription-Token'],'TEST-KEY');return new Response(JSON.stringify({web:{results:[{title:'دليل الأعمال',url,description:'فرصة تحتاج مراجعة'},{title:'internal',url:'https://127.0.0.1'}]}}));};
 const r=await marketingAction(ctx,{action:'search'},actor);assert.equal(r.opportunities.length,1);assert.equal(r.opportunities[0].pricing,'غير معروف');assert.equal(r.opportunities[0].source,'Brave Search');assert.ok(!JSON.stringify(r).includes('TEST-KEY'));
 await assert.rejects(marketingAction(ctx,{action:'search'},actor),e=>e.status===429);
});
test('favourites and long URL rechecks use full identity and survive search updates',async()=>{
 let r=await marketingAction(ctx,{action:'favourite',id:url,favourite:true},actor);assert.equal(r.opportunities[0].favourite,true);now=new Date(now.getTime()+61000);
 r=await marketingAction(ctx,{action:'recheck',id:url},actor);assert.equal(r.opportunities[0].verification,'indexed');assert.equal(r.opportunities[0].favourite,true);
 now=new Date(now.getTime()+61000);globalThis.fetch=async()=>new Response(JSON.stringify({web:{results:[]}}));r=await marketingAction(ctx,{action:'search'},actor);assert.equal(r.opportunities.length,1,'saved favourites persist when absent from search');
});
test('provider failure propagates, never becomes fabricated success',async()=>{globalThis.fetch=async()=>new Response('error',{status:503});await assert.rejects(searchMarketing(ctx,'q'),e=>e.code==='search_failed');});
