/** Read-only diagnostic. No messages, writes, secrets, contact data or raw account IDs. */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseFirebaseServiceAccountJson } from './staging-credentials.mjs';
import { STAGING_PROJECT_ID, assertStagingServiceAccount } from './staging-qa-identity.mjs';
import { guestSearch, publicInventoryExclusion } from '../worker/src/office-os/public-search-service.js';
import { normalizeInventoryDistrict } from '../public/os/domain/inventory-query-domain.js';
import { listingStatus, isMatchable } from '../public/os/domain/direct-match-domain.js';
const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, STAGING_PROJECT_ID);
if (!parsed.serviceAccount) throw Error('Staging credential unavailable');
assertStagingServiceAccount(parsed.serviceAccount);
const app = initializeApp({ credential: cert(parsed.serviceAccount), projectId: STAGING_PROJECT_ID });
const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0,16);
const report = { generatedAt: new Date().toISOString(), projectId: STAGING_PROJECT_ID, readOnly: true, district: 'درة العقيق', candidates: [] };
try {
 const db = getFirestore(app);
 const sessions = new Map();
 const ctx = { env:{FIREBASE_PRIVATE_KEY:parsed.serviceAccount.private_key}, now:()=>new Date(), deps:{sha256Hex:async value=>createHash('sha256').update(value).digest('hex'),appError:(code,status,message)=>Object.assign(Error(message),{code,status})}, store:{
  get:async path=>path[0]==='publicSearchSessions'?sessions.get(path.join('/')):((await db.doc(path.join('/')).get()).data()||null),
  list:async(path,limit=300)=>(await db.collection(path.join('/')).limit(limit).get()).docs.map(doc=>({...doc.data(),id:doc.id})),
  create:async(path,data)=>{if(path[0]!=='publicSearchSessions')throw Error('read_only_guard');const key=path.join('/');if(sessions.has(key))return false;sessions.set(key,data);return true;}
 }};
 const offices = await db.collection('publicOffices').limit(100).get();
 const mappings = await db.collection('whatsapp_accounts').limit(100).get();
 report.officeScanLimited = offices.size === 100;
 for (const doc of offices.docs) {
  const office = doc.data();
  const rows = await db.collection('offices').doc(doc.id).collection('opportunities').limit(301).get();
  const candidates = rows.docs.filter(d => normalizeInventoryDistrict(d.data().district) === normalizeInventoryDistrict(report.district));
  if (!candidates.length) continue;
  const search = office.active === false ? {results:[]} : await guestSearch(ctx,{input:{officeId:doc.id,scope:'office',mode:'inventory',criteria:{district:report.district},requestKey:`audit_${hash(doc.id)}_${Date.now()}`},ip:'read-only-audit'});
  const returned=new Set(search.results.map(row=>row.reference));
  const journeys = await db.collection('offices').doc(doc.id).collection('journeys').limit(300).get();
  const openJourneys = journeys.docs.map(d => ({...d.data(), id:d.id}));
  for (const record of candidates) {
   const row = record.data();
   const exclusion = office.active === false ? 'office_inactive' : publicInventoryExclusion(row, doc.id);
   const status = listingStatus(row,{recordId:record.id,openJourneys});
   report.candidates.push({ officeTrace:hash(doc.id), recordTrace:hash(`${doc.id}/${record.id}`), propertyType:row.propertyType||'', price:row.priceOrBudget||row.salePrice||0,
    sharedSearchReturnedRecord:returned.has(`${doc.id}:${record.id}`),published:row.publicSearchVisible===true, lifecycle:row.lifecycleStatus||'', status, exclusion:exclusion||(!isMatchable(status,{showNegotiating:office.publicSearchShowNegotiating!==false})?'not_matchable':''),
    eligible:!exclusion&&isMatchable(status,{showNegotiating:office.publicSearchShowNegotiating!==false}), inventoryScanLimited:rows.size>300,
    whatsappMappings:mappings.docs.filter(d=>d.data().officeId===doc.id).map(d=>({mappingTrace:hash(d.id),status:d.data().status||'',platformType:d.data().platformType||''})) });
  }
 }
 const out=process.env.DIAGNOSTIC_OUT||'artifacts/inventory-link'; mkdirSync(out,{recursive:true});
 writeFileSync(`${out}/staging-inventory-read-audit.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
} finally { await app.delete(); }
