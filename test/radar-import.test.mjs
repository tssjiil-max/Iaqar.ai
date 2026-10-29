import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseRadarExport } from '../public/os/domain/radar-import-domain.js';
import { importRadarExport, radarImportStatus } from '../worker/src/office-os/radar-import-service.js';
const ad = {schemaVersion:1, listingId:'local-fingerprint-1', category:'شقة',intent:'عرض',operation:'بيع',city:'المدينة المنورة',cityBasis:'explicit',district:'عروة',price:600000.50,areaSqm:180,originalText:'شقة للبيع في المدينة المنورة حي عروة بسعر 600000.50 ريال',capturedAt:1793260000000,contacts:[{phone:'0551234567',role:'sender',source:'whatsapp'}]};
const appError=(code,status,message)=>Object.assign(new Error(message),{code,status});
function context(){const rows=new Map();return {env:{FIREBASE_PROJECT_ID:'iaqar-ai-staging',OPPORTUNITY_SCOUT:'enabled'},now:()=>new Date('2026-10-29T13:00:00Z'),deps:{appError,sha256Hex:async x=>createHash('sha256').update(x).digest('hex')},store:{get:async p=>rows.get(p.join('/')) || (p.includes('scoutSettings') ? {enabled:true} : undefined),set:async(p,d)=>rows.set(p.join('/'),d),list:async()=>[]},rows};}
const actor={uid:'owner',isManager:true};
test('accepts the Android v1 single export and keeps decimals without inventing a city',()=>{
 const r=parseRadarExport(JSON.stringify(ad));assert.equal(r.items[0].structured.price,600000.50);assert.equal(r.items[0].sourceId,ad.listingId);
 const assumed=parseRadarExport({...ad,cityBasis:'assumed_default'});assert.equal(assumed.items[0].structured.city,'');
});
test('rejects wrong schemas, missing IDs, invalid kinds and oversized original text',()=>{
 for(const value of [{...ad,schemaVersion:2},{...ad,listingId:''},{...ad,intent:'unknown'},{...ad,originalText:'x'.repeat(4001)}]) assert.throws(()=>parseRadarExport(value));
 assert.throws(()=>parseRadarExport('[]'));assert.throws(()=>parseRadarExport('x'.repeat(200001)));
});
test('only explicit contact sharing includes labelled evidence; no contact is inferred to be owner',()=>{
 assert.equal(parseRadarExport(ad).items[0].contacts.length,0);
 assert.equal(parseRadarExport(ad,{includeContacts:true}).items[0].contacts[0].role,'sender');
});
test('imports to office-scoped pending feed, never inventory, deduplicates repeat and calls existing cycle',async()=>{
 const ctx=context();let cycles=0;
 const runCycle=async()=>{cycles++;return {stats:{kept:1}}};
 const r=await importRadarExport(ctx,{officeId:'office-a',actor,input:ad,runCycle});
 assert.equal(r.saved,1);assert.equal(cycles,1);const entry=[...ctx.rows.entries()].find(([p])=>p.includes('/scoutFeed/'));
 assert.ok(entry[0].startsWith('offices/office-a/'));assert.equal(entry[1].reviewStatus,'PENDING_REVIEW');assert.equal(entry[1].sourceName,'رادار الوسيط');assert.equal(entry[1].structured.includes('600000.5'),true);
 assert.equal([...ctx.rows.keys()].some(x=>x.includes('/opportunities/')),false);
 const replay=await importRadarExport(ctx,{officeId:'office-a',actor,input:ad,runCycle});assert.equal(replay.duplicates,1);assert.equal(cycles,2);
 const other=await importRadarExport(ctx,{officeId:'office-b',actor,input:ad,runCycle});assert.equal(other.saved,1);
});
test('production and non-managers cannot import even when UI is bypassed',async()=>{
 const ctx=context();await assert.rejects(importRadarExport(ctx,{officeId:'office-a',actor:{uid:'broker',isManager:false},input:ad}),e=>e.status===403);
 ctx.env.FIREBASE_PROJECT_ID='aqar-b5d76';assert.equal(radarImportStatus(ctx).available,false);
 await assert.rejects(importRadarExport(ctx,{officeId:'office-a',actor,input:ad}),e=>e.status===503);assert.equal(ctx.rows.size,0);
});
test('pipeline failure reports saved but deferred; retry still invokes the pending cycle',async()=>{
 const ctx=context();const r=await importRadarExport(ctx,{officeId:'office-a',actor,input:ad,runCycle:async()=>{throw Error('offline')}});assert.equal(r.saved,1);assert.equal(r.processing,'DEFERRED');
 let cycles=0;await importRadarExport(ctx,{officeId:'office-a',actor,input:ad,runCycle:async()=>{cycles++;return {}}});assert.equal(cycles,1);
});
test('radar source retains its label through the existing feed adapter',async()=>{
 const {SOURCE_ADAPTERS,sourceLabel}=await import('../worker/src/office-os/scout-sources.js');
 const adapter=SOURCE_ADAPTERS.find(x=>x.id==='broker_feed');
 const got=await adapter.fetch({store:{queryAfter:async()=>[{id:'sf_radar_id',sourceType:'BROKER_RADAR',single:true,pinned:true,text:ad.originalText,createdAt:'2026-10-29T13:00:00Z',structured:JSON.stringify({kind:'OFFER',city:ad.city,price:ad.price})}]}},{officeId:'office-a',since:new Date(0),limit:20});
 assert.equal(got.items[0].sourceId,'broker_radar');assert.equal(sourceLabel(got.items[0].sourceId),'رادار الوسيط');assert.equal(got.items[0].structured.price,600000.50);
});
test('a cycle with no fetched items cannot claim successful processing',async()=>{
 const ctx=context();const r=await importRadarExport(ctx,{officeId:'office-a',actor,input:ad,runCycle:async()=>({ok:true,stats:{fetched:0}})});assert.equal(r.processing,'DEFERRED');assert.equal(r.saved,1);
});
test('office-scoped source keeps updates on the same feed document',async()=>{
 const ctx=context();await importRadarExport(ctx,{officeId:'office-a',actor,input:ad});
 const r=await importRadarExport(ctx,{officeId:'office-a',actor,input:{...ad,price:550000}});
 assert.equal(r.updated,1);assert.equal([...ctx.rows.keys()].filter(k=>k.includes('/scoutFeed/')).length,1);
});
