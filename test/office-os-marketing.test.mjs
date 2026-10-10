import test from 'node:test';
import assert from 'node:assert/strict';
import { marketingProfile, makeDraft, marketingCampaigns, marketingText, safeOpportunityUrl } from '../public/os/domain/marketing-domain.js';
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } from '../scripts/qa/office-os/server.mjs';
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
async function call(body, uid=OWNER_A, env=h.env) {
 const response = await h.worker.fetch(new Request('https://worker.test/os/marketing', {method:'POST',headers:{'content-type':'application/json', ...(uid?{authorization:`Bearer ${idTokenFor(uid)}`}:{})},body:JSON.stringify({officeId:OFFICE_A,...body})}),env,{waitUntil(){}});
 return {status:response.status, body:await response.json()};
}
test('profile only allows office public identity; no property/customer details',()=>{
 const p=marketingProfile({officeName:'مكتب ألفا',city:'المدينة',phone:'0501111111',customers:['SECRET'],offers:['SECRET']},'https://office.test/m/alpha');
 assert.equal(p.name,'مكتب ألفا'); assert.ok(!JSON.stringify(p).includes('SECRET'));
 assert.match(marketingText(p,'owners','short'),/https:\/\/office.test\/m\/alpha/);
 assert.ok(marketingCampaigns(p,{budget:0}).every(c=>c.budget===0));
});
test('draft validation and URL sanitation',()=>{
 assert.throws(()=>makeDraft({headline:'',body:'',size:'square'}));
 assert.throws(()=>makeDraft({headline:'hi',size:'giant'}));
 assert.equal(makeDraft({headline:'مرحبا',body:'خدماتنا',size:'story',fontSize:9999}).fontSize,80);
 for(const u of ['javascript:alert(1)','https://localhost/x','https://127.0.0.1','https://[::1]','https://169.254.169.254','https://user:pass@site.test'])assert.equal(safeOpportunityUrl(u),'');
 assert.equal(safeOpportunityUrl('https://example.com/a'),'https://example.com/a');
});
test('real Worker requires authentication and isolates both offices',async()=>{
 assert.equal((await call({action:'load'},null)).status,401);
 assert.equal((await call({action:'load',officeId:OFFICE_B})).status,403);
 const a=await call({action:'load'}); const b=await call({action:'load',officeId:OFFICE_B},OWNER_B);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.notEqual(a.body.profile.name,b.body.profile.name);
 assert.equal(a.body.search.status,'requires_configuration');
 assert.equal(a.body.report.visits,null);assert.equal(a.body.report.conversions,null);
});
test('draft save, private read, manager approval and edit invalidation',async()=>{
 let s=await call({action:'save',draft:{headline:'مكتبنا',body:'أرسل طلبك',size:'square'}});
 assert.equal(s.status,200);const id=s.body.draft.id;
 assert.equal((await call({action:'approve',id},BROKER_A2)).status,403);
 assert.equal((await call({action:'approve',id,officeId:OFFICE_B},OWNER_B)).status,404);
 const a=await call({action:'approve',id,version:s.body.draft.version,identityKey:s.body.draft.identityKey});assert.equal(a.body.draft.status,'approved');
 const e=await call({action:'save',draft:{id,version:a.body.draft.version,headline:'تعديل',body:'النص',size:'story'}});
 assert.equal(e.body.draft.status,'draft');assert.equal(e.body.draft.approvedBy,'');
 const conflict=await call({action:'save',draft:{id,version:a.body.draft.version,headline:'قديم',size:'square'}});assert.equal(conflict.status,409);
 const b=await call({action:'load',officeId:OFFICE_B},OWNER_B);assert.ok(!b.body.drafts.some(x=>x.id===id));
});
test('production marketing rejects before writing',async()=>{
 const r=await call({action:'save',draft:{headline:'blocked',size:'square'}},OWNER_A,{...h.env,DEPLOYMENT_ENV:'production'});
 assert.equal(r.status,403);
});
test('canonical configured image and specialty fields are promoted',()=>{
 const image='data:image/jpeg;base64,'+'A'.repeat(3000);const p=marketingProfile({officeName:'Configured',brokerPhotoUrl:image,specialties:['sale','rent']},'https://office.test/m/alpha');assert.equal(p.logoUrl,image);assert.match(p.services,/بيع/);assert.match(p.services,/تأجير/);
});
test('approval requires exact reviewed version and office identity changes invalidate approval',async()=>{
 const s=await call({action:'save',draft:{headline:'Review',body:'نص',size:'square'}});const d=s.body.draft;
 assert.equal((await call({action:'approve',id:d.id})).status,400);
 const a=await call({action:'approve',id:d.id,version:d.version,identityKey:d.identityKey});assert.equal(a.body.draft.status,'approved');
 const stored=h.store.get(`offices/${OFFICE_A}`);h.store.seed(`offices/${OFFICE_A}`,{...stored,phone:'0509999999'});
 const load=await call({action:'load'});assert.equal(load.body.drafts.find(x=>x.id===d.id).status,'draft');
 assert.ok(load.body.audit.some(x=>x.action==='approved'&&x.draftId===d.id));
});
test('approval rejects an identity that was not reviewed and rejects oversized bodies',async()=>{
 const s=await call({action:'save',draft:{headline:'Identity',size:'square'}});
 const d=s.body.draft;const bad=await call({action:'approve',id:d.id,version:d.version,identityKey:'outdated'});assert.equal(bad.status,409);
 const large=await call({action:'save',draft:{headline:'x'.repeat(20000),size:'square'}});assert.equal(large.status,413);
});
