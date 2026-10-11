// One real query through the existing Staging scout. No direct provider calls and no messaging.
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { parseFirebaseServiceAccountJson } from '../../staging-credentials.mjs';
const PROJECT='iaqar-ai-staging';
const APP='https://iaqar-ai-staging--staging-9c4b0k7h.web.app';
const WORKER='https://iaqar-intake-staging.iaqar-ai.workers.dev';
const {serviceAccount}=parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,PROJECT);
if(serviceAccount.project_id!==PROJECT)throw new Error('Staging credentials required');
initializeApp({credential:cert(serviceAccount),projectId:PROJECT});
const db=getFirestore(), auth=getAuth();
const run=String(process.env.GITHUB_RUN_ID||Date.now());
const officeId=`qa-office-serper-${run}`, uid=`qa-serper-${run}`;
const ref=db.collection('offices').doc(officeId);
const report={query:'عمارة للبيع في حي الهجرة بالمدينة المنورة من المالك',officeId,worker:WORKER,productionTouched:false};
const budget=async()=>Number((await db.doc('_system/scoutSerperBudget').get()).data()?.total||0);
let token;
async function call(route,body={}){
 const res=await fetch(WORKER+route,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({officeId,...body})});
 const data=await res.json();if(!res.ok)throw new Error(`scout ${route} status ${res.status} code ${data.code||''}`);return data;
}
try{
 await auth.createUser({uid});
 await ref.create({officeId,officeName:'اختبار Serper',ownerUid:uid,active:true,isTestFixture:true,city:'المدينة المنورة',platformOpportunityOnboardingAckAt:new Date()});
 await ref.collection('members').doc(uid).create({uid,role:'owner',active:true,isTestFixture:true});
 const apiKey=(await (await fetch(APP+'/__/firebase/init.json')).json()).apiKey;
 const signed=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:await auth.createCustomToken(uid),returnSecureToken:true})});
 token=(await signed.json()).idToken;if(!token)throw new Error('QA sign-in failed');
 await call('/os/scout/settings',{settings:{enabled:true,notify:false,sources:{office_inbox:false,broker_feed:false,partner_feed:false,qa_fixture:false,x_search:false,web_search:true}}});
 const before=await budget();
 const started=await call('/os/scout/search',{search:{mode:'GENERAL',seek:'OFFER',tx:'sale',propertyTypes:['عمارة'],city:'المدينة المنورة',districts:'الهجرة',nlText:report.query},requestKey:`serper-${run}`});
 report.taskId=started.taskId;
 // GENERAL queues its first source round; explicitly run it before reading evidence.
 await call('/os/scout/search/control',{taskId:started.taskId,action:'RUN_NOW'});
 const overview=await call('/os/scout/overview');
 const caches=(await ref.collection('scoutSerperCache').get()).docs.map(d=>d.data());
 report.providerConnected=caches.some(d=>d.status==='complete');
 report.providerErrors=caches.filter(d=>d.status==='failed').map(d=>d.code);
 report.realResults=caches.flatMap(d=>JSON.parse(d.rowsJson||'[]')).map(r=>({title:r.title,url:r.url,snippet:r.snippet}));
 report.board=overview.board||[];
 report.evaluatedFinds=(await ref.collection('scoutOpportunities').get()).docs.map(d=>{const v=d.data();return {id:d.id,band:v.band,surface:v.surface,title:v.title,price:v.price,area:v.area,district:v.district,sources:v.sourcesJson};});
 report.queriesUsed=await budget()-before;
 const repeatBefore=await budget();
 await call('/os/scout/search/control',{taskId:started.taskId,action:'RUN_NOW'});
 report.repeatQueries=await budget()-repeatBefore;
 report.location=`${APP}/#/scout (QA office ${officeId})`;
 if(!report.providerConnected)throw new Error('Serper connection did not succeed');
 if(report.repeatQueries!==0)throw new Error('Repeated search consumed credit');
} catch(error){report.error=String(error.message);process.exitCode=1;}
finally{
 if(token)await call('/os/scout/settings',{settings:{enabled:false,notify:false}}).catch(()=>{});
 await auth.deleteUser(uid).catch(()=>{});
 const dir=process.env.OUT_DIR||'/tmp/serper-evidence';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
