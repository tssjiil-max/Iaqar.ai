/** Staging only. Refuse to overwrite live rules that differ from the reviewed baseline. */
import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';
import {initializeApp,cert} from 'firebase-admin/app';import {getSecurityRules} from 'firebase-admin/security-rules';
import {parseFirebaseServiceAccountJson} from './staging-credentials.mjs';
if(process.env.IAQAR_DEPLOY_TARGET!=='staging-rules')throw new Error('Staging rules target required');
const {serviceAccount}=parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,'iaqar-ai-staging');
if(serviceAccount.project_id!=='iaqar-ai-staging')throw new Error('Refusing non-Staging service account');
const baseline=execFileSync('git',['show','cbe4995c9d94a5e533acb1120c9eed79eafce22b:firestore.rules'],{encoding:'utf8'});
const next=readFileSync('firestore.rules','utf8');const normalize=s=>s.replace(/\r\n/g,'\n').trim();
initializeApp({credential:cert(serviceAccount),projectId:'iaqar-ai-staging'});const rules=getSecurityRules();const live=await rules.getFirestoreRuleset();const source=live.source?.[0]?.content||'';
if(normalize(source)===normalize(next)){console.log('Marketing rules already deployed on Staging');process.exit(0);}
if(normalize(source)!==normalize(baseline))throw new Error('Staging rules differ from reviewed baseline; refusing to overwrite unrelated rules');
await rules.releaseFirestoreRulesetFromSource(next);const released=await rules.getFirestoreRuleset();if(normalize(released.source?.[0]?.content||'')!==normalize(next))throw new Error('Staging rules verification failed');
console.log('Verified marketing collection protection on iaqar-ai-staging; Production untouched');
