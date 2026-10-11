import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { searchConfig, webSearchAdapter } from '../worker/src/office-os/scout-web.js';
const env = {DEPLOYMENT_ENV:'staging',SCOUT_SERPER:'enabled',SCOUT_SEARCH_PROVIDER:'serper',SERPER_API_KEY:'test-secret'};
function context(extra={}) {
 const docs=new Map();
 const store={async get(p){return docs.get(p.join('/'))||null;},async create(p,d){const k=p.join('/');if(docs.has(k))return false;docs.set(k,{...d});return true;},async set(p,d){const k=p.join('/');docs.set(k,{...docs.get(k),...d});},async update(p,fn){const k=p.join('/');const d=docs.get(k);const patch=await fn(d);if(!patch)return {patch:null};docs.set(k,{...d,...patch});return {patch,next:docs.get(k)};}};
 return {env:{...env,...extra},store,docs,deps:{sha256Hex:async s=>createHash('sha256').update(s).digest('hex')}};
}
const form={seek:'OFFER',tx:'sale',propertyTypes:['عمارة'],city:'المدينة المنورة',districts:['الهجرة'],freshnessDays:7};
test('Serper is locked: a key and a provider name are not enough without the switch, and nothing in the repository sets any of them',async()=>{
 assert.equal(searchConfig({...env,SCOUT_SERPER:''}).ready,false);
 assert.equal(searchConfig({DEPLOYMENT_ENV:'staging',SERPER_API_KEY:'k'}).ready,false);
 assert.equal(searchConfig({...env,DEPLOYMENT_ENV:'production'}).ready,false);
 const fs=await import('node:fs');
 for (const file of ['worker/wrangler.toml','scripts/deploy-staging.sh','.github/workflows/deploy-unified-staging.yml','.github/workflows/production-pilot.yml']) {
  assert.equal(/SERPER|SCOUT_SEARCH_PROVIDER|SCOUT_SEARCH_KEY/.test(fs.readFileSync(new URL(`../${file}`, import.meta.url),'utf8')),false,`${file} must not unlock a search provider`);
 }
});
test('Serper is available only on Staging and clamps free-credit limits',()=>{
 assert.equal(searchConfig(env).ready,true);
 assert.equal(searchConfig({...env,DEPLOYMENT_ENV:'production'}).ready,false);
 assert.equal(searchConfig({...env,SCOUT_SEARCH_DAILY_PER_OFFICE:'999'}).perDay,5);
 assert.equal(searchConfig({...env,SCOUT_SEARCH_DAILY_PER_OFFICE:'0'}).perDay,0);
});
test('Serper caches repeats and reserves global credits before failed calls',async()=>{
 const ctx=context({SERPER_GLOBAL_DAILY_LIMIT:'1'});const original=globalThis.fetch;let count=0;
 globalThis.fetch=async(_url, init)=>{if(init.redirect==='error')throw new TypeError('Invalid redirect value: Workers only support follow or manual');count++;return new Response(JSON.stringify({organic:[{title:'عمارة للبيع في الهجرة المدينة المنورة',link:'https://example.sa/ad/1',snippet:'عمارة للبيع من المالك مساحة 600 متر بسعر 2000000 ريال'}]}));};
 try {
  const first=await webSearchAdapter.fetch(ctx,{forms:[form,form],now:new Date('2026-10-11T12:00:00Z')});
  assert.equal(first.queries,1);assert.equal(count,1);assert.ok(first.items.length);
  assert.ok([...ctx.docs.keys()].some(k=>k.includes("/scoutState/serper_")), "cache must use the existing Worker-only collection");
  const repeat=await webSearchAdapter.fetch(ctx,{forms:[form],now:new Date('2026-10-11T12:10:00Z')});
  assert.equal(repeat.queries,0);assert.equal(count,1);assert.equal(repeat.items[0].url,first.items[0].url);
  await webSearchAdapter.fetch(ctx,{forms:[{...form,districts:['شوران']}],now:new Date('2026-10-11T12:20:00Z')});assert.equal(count,1);
 }finally{globalThis.fetch=original;}
});
test('a failed Serper request consumes its reservation and is not retried',async()=>{
 const ctx=context();const original=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;return new Response('unauthorized',{status:401});};
 try{
  await assert.rejects(webSearchAdapter.fetch(ctx,{forms:[form],now:new Date('2026-10-11T12:00:00Z')}),e=>e.code==='search_http_401');
  await webSearchAdapter.fetch(ctx,{forms:[form],now:new Date('2026-10-11T12:01:00Z')});
  assert.equal(count,1);assert.equal(ctx.docs.get('_system/scoutSerperBudget').total,1);
 }finally{globalThis.fetch=original;}
});
