import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatchingAdmission } from '../worker/src/matching-admission-domain.js';
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } from '../scripts/qa/office-os/server.mjs';
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
async function call(route, body, uid) {
 const headers = {'content-type':'application/json'};
 if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
 const r = await h.worker.fetch(new Request(`https://worker.test${route}`, {method:'POST',headers,body:JSON.stringify(body)}),h.env,{waitUntil(){}});
 return {status:r.status,body:await r.json()};
}
const base = {officeId:OFFICE_A,kind:'owner',name:'الوسيط الخارجي',phone:'0559876543',propertyType:'شقة',city:'الرياض',district:'الملقا',purpose:'SALE',transactionType:'sale',amount:1200000,details:'',mediaPaths:[],imageCount:0,hasVideo:false,source:'office_public_link',status:'new',submitterRole:'EXTERNAL_BROKER',externalBrokerOffice:'مكتب مستقل',externalBrokerLicense:'1200012345',representationClaim:'OWNER',representationReference:'تفويض مرجع 123'};
let recordId;
test('external offer retains role and claimed evidence without ownership or verified authority',async()=>{
 h.store.seed(`offices/${OFFICE_A}/publicIntake/external00001`,base);
 const r=await call('/pipeline/public-intake',{officeId:OFFICE_A,intakeId:'external00001'});
 assert.equal(r.status,201,JSON.stringify(r.body));recordId=r.body.opportunityId;
 const saved=h.store.get(`offices/${OFFICE_A}/opportunities/${recordId}`);
 assert.equal(saved.submitterRole,'EXTERNAL_BROKER');assert.equal(saved.advertiserRole,'BROKER');assert.equal(saved.representationStatus,'PENDING');assert.equal(saved.cooperationStatus,'REQUESTED');assert.equal(saved.externalBrokerOffice,'مكتب مستقل');assert.equal(saved.contactType,'broker');
 assert.equal(evaluateMatchingAdmission(saved).isReadyForMatching,false);
 assert.ok(h.store.list(`offices/${OFFICE_A}/notifications`).some(n=>n.opportunityId===recordId));
});
test('anonymous or foreign office cannot verify cooperation',async()=>{
 const body={officeId:OFFICE_A,recordId,representationStatus:'VERIFIED',cooperationStatus:'ACCEPTED',evidenceReference:'وثيقة 123'};
 assert.equal((await call('/os/records/cooperation',body)).status,401);
 assert.equal((await call('/os/records/cooperation',body,OWNER_B)).status,403);
});
test('office review requires evidence and acceptance without automatically creating commission',async()=>{
 assert.equal((await call('/os/records/cooperation',{officeId:OFFICE_A,recordId,representationStatus:'VERIFIED',cooperationStatus:'ACCEPTED'},OWNER_A)).status,400);
 const r=await call('/os/records/cooperation',{officeId:OFFICE_A,recordId,representationStatus:'VERIFIED',cooperationStatus:'ACCEPTED',evidenceReference:'تفويض موثق 123؛ تمت مراجعة الهوية والرخصة'},OWNER_A);
 assert.equal(r.status,200,JSON.stringify(r.body));
 const saved=h.store.get(`offices/${OFFICE_A}/opportunities/${recordId}`);
 assert.equal(saved.representationVerifiedBy,OWNER_A);assert.equal(saved.commissionStatus,'NONE');assert.equal(evaluateMatchingAdmission(saved).isReadyForMatching,true);
 assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some(x=>x.action==='EXTERNAL_COOPERATION_REVIEWED'));
});
test('closed cooperation cannot enter matching even through ordinary record edits',()=>{
 const saved=h.store.get(`offices/${OFFICE_A}/opportunities/${recordId}`);
 assert.equal(evaluateMatchingAdmission({...saved,cooperationStatus:'CLOSED',matchingReadiness:'READY_FOR_MATCHING'}).isReadyForMatching,false);
});
test('forged verified intake metadata cannot activate a participation',async()=>{
 h.store.seed(`offices/${OFFICE_A}/publicIntake/external00002`,{...base,district:'العقيق',representationStatus:'VERIFIED',cooperationStatus:'ACCEPTED',representationVerifiedBy:OWNER_A});
 const r=await call('/pipeline/public-intake',{officeId:OFFICE_A,intakeId:'external00002'});
 assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`).representationStatus,'PENDING');
});
for (const [kind,purpose,tx,claim] of [['owner','RENT','rent','OWNER'],['client','PURCHASE','sale','BUYER'],['client','LEASE_REQUEST','rent','TENANT']]) test(`external ${purpose} retains participation without premature matching`,async()=>{
 const id=`ext-${purpose}-00001`;h.store.seed(`offices/${OFFICE_A}/publicIntake/${id}`,{...base,kind,purpose,transactionType:tx,representationClaim:claim,district:purpose});
 const r=await call('/pipeline/public-intake',{officeId:OFFICE_A,intakeId:id});assert.equal(r.status,201,JSON.stringify(r.body));
 const saved=h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`);
 assert.equal(saved.advertiserRole,'BROKER');assert.equal(saved.purpose,purpose);assert.equal(saved.representationClaim,claim);assert.equal(r.body.matches,0);
 assert.equal(h.store.list(`offices/${OFFICE_A}/members`).length,2);
});
test('commission requires an explicit agreement reference and has no default percentage',async()=>{
 assert.equal((await call('/os/records/cooperation',{officeId:OFFICE_A,recordId,commissionStatus:'AGREED',commissionType:'PERCENT',commissionValue:25},OWNER_A)).status,400);
 assert.equal((await call('/os/records/cooperation',{officeId:OFFICE_A,recordId,commissionStatus:'AGREED',commissionType:'PERCENT',commissionValue:25,commissionAgreementReference:'اتفاق موقع 456'},OWNER_A)).status,200);
 assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${recordId}`).commissionValue,25);
});
test('external broker matching can reach existing journey while external access remains office mediated',async()=>{
 const request=await call('/os/records/save',{officeId:OFFICE_A,requestKey:'ext-client-1',record:{kind:'REQUEST',purpose:'PURCHASE',propertyType:'شقة',city:'الرياض',district:'الملقا',price:1200000,contactName:'عميل مستقل',contactPhone:'0551122334'}},OWNER_A);
 assert.equal(request.status,200,JSON.stringify(request.body));
 const match=h.store.list(`offices/${OFFICE_A}/matches`).find(m=>m.offerId===recordId&&m.requestId===request.body.recordId);assert.ok(match);
 const approve=await call('/os/review/decide',{officeId:OFFICE_A,matchId:match.id,decision:'approve'},OWNER_A);assert.equal(approve.status,200,JSON.stringify(approve.body));
 const journey=h.store.get(`offices/${OFFICE_A}/journeys/${approve.body.journeyId}`);assert.equal(journey.offerParticipantRole,'EXTERNAL_BROKER');
 assert.equal((await call('/os/session/links',{officeId:OFFICE_A,journeyId:journey.journeyId},OWNER_A)).status,409);
 assert.equal((await call('/os/proposals/create',{officeId:OFFICE_A,journeyId:journey.journeyId,kind:'INFO_REQUEST',recipients:['owner'],fields:{question:'تفاصيل'}},OWNER_A)).status,409);
});
test('repeated identical external participation deduplicates across distinct intake ids',async()=>{
 h.store.seed(`offices/${OFFICE_A}/publicIntake/external00003`,base);
 const r=await call('/pipeline/public-intake',{officeId:OFFICE_A,intakeId:'external00003'});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.duplicate,true);assert.equal(r.body.opportunityId,recordId);
});
test('representation review is invalidated when ordinary edit changes represented scope or identity',async()=>{
 const r=await call('/os/records/save',{officeId:OFFICE_A,recordId,record:{kind:'OFFER',purpose:'RENT',propertyType:'شقة',city:'الرياض',district:'الملقا',price:1200000,contactName:'وسيط آخر',contactPhone:'0559876543'}},OWNER_A);
 assert.equal(r.status,200,JSON.stringify(r.body));const saved=h.store.get(`offices/${OFFICE_A}/opportunities/${recordId}`);
 assert.equal(saved.representationStatus,'PENDING');assert.equal(saved.cooperationStatus,'REQUESTED');assert.equal(saved.commissionStatus,'NONE');assert.equal(evaluateMatchingAdmission(saved).isReadyForMatching,false);
});
test('office review cannot accept a representation that contradicts edited request purpose',async()=>{
 const id='opp_intake_ext-PURCHASE-00001';
 h.store.seed(`offices/${OFFICE_A}/opportunities/${id}`,{...h.store.get(`offices/${OFFICE_A}/opportunities/${id}`),purpose:'LEASE_REQUEST',representationClaim:'BUYER'});
 const r=await call('/os/records/cooperation',{officeId:OFFICE_A,recordId:id,representationStatus:'VERIFIED',cooperationStatus:'ACCEPTED',evidenceReference:'تمت مراجعة التفويض'},OWNER_A);
 assert.equal(r.status,400,JSON.stringify(r.body));
});
