import test from 'node:test';import assert from 'node:assert/strict';
import { marketingAction } from '../worker/src/office-os/marketing-service.js';
const records=new Map([['offices/alpha',{officeName:'مكتب ألفا',city:'المدينة',publicSlug:'alpha',phone:'0501111111',customers:['PRIVATE']}]]);let count=0;const original=globalThis.fetch;test.after(()=>globalThis.fetch=original);
const ctx={officeId:'alpha',appOrigin:'https://office.example',env:{DEPLOYMENT_ENV:'staging'},now:()=>new Date('2026-10-10T12:00:00Z'),deps:{appError:(code,status,publicMessage)=>Object.assign(new Error(publicMessage),{code,status,publicMessage})},store:{async get(p){return records.get(p.join('/'))||null;},async create(p,v){if(records.has(p.join('/')))return false;records.set(p.join('/'),structuredClone(v));return true;},async update(p,fn){const current=structuredClone(records.get(p.join('/')));const patch=await fn(current);const next={...current,...patch};records.set(p.join('/'),next);return {current,patch,next};}}};const actor={uid:'u',isManager:true};
test('AI unavailable is explicitly reported; no billed request',async()=>{const r=await marketingAction(ctx,{action:'generate'},actor);assert.equal(r.generation.status,'requires_configuration');});
test('AI uses existing Gemini client, only office public fields, and caches identical requests',async()=>{
 ctx.env.GEMINI_API_KEY='SECRET';globalThis.fetch=async(url,init)=>{count++;assert.match(url,/^https:\/\/generativelanguage.googleapis.com\//);assert.ok(!init.body.includes('PRIVATE'));assert.ok(!init.body.includes('SECRET'));return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({headline:'مكتبك قريب منك',body:'أرسل عقارك أو طلبك عبر رابط مكتبنا'})}]}}]}));};
 const a=await marketingAction(ctx,{action:'generate',type:'intro'},actor);assert.equal(a.generation.status,'ready');assert.match(a.generation.draft.headline,/مكتبك/);
 const b=await marketingAction(ctx,{action:'generate',type:'intro'},actor);assert.equal(b.generation.cached,true);assert.equal(count,1);
});
test('AI cannot return false licenses or guaranteed claims',async()=>{
 ctx.now=()=>new Date('2026-10-10T12:02:00Z');globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({headline:'ترخيص مضمون',body:'أرباح مضمونة 100%'})}]}}]}));
 await assert.rejects(marketingAction(ctx,{action:'generate',type:'owners'},actor),e=>e.code==='unsafe_generated_copy');
});
