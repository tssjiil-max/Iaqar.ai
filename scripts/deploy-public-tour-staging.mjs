#!/usr/bin/env node
/** Hosting-only: no Worker, rules, secrets, channels or Production deployment. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
const HOST='https://iaqar-ai-staging--staging-9c4b0k7h.web.app';
const PROD='https://iaqar.ai';
const project='iaqar-ai-staging';
const expected='fc68af7bec1eab191b560119346c6cb188418cb5';
const version=async base=>{const r=await fetch(base+'/version.json',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Version unavailable');return r.json();};
const before=await version(HOST);const productionBefore=await version(PROD);
if(before.fullSha!==expected)throw new Error('Staging advanced; rebase and review before deploying. Refusing stale tree.');
if(process.env.GITHUB_REF!=='refs/heads/codex/public-product-tour-20261011')throw new Error('This deploy is restricted to the product-tour branch.');
if(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON)throw new Error('Missing Staging credential');
const credential='/tmp/iaqar-public-tour-gac.json';
try{
 execFileSync('node',['scripts/staging-gac.mjs',credential],{stdio:'inherit',env:{...process.env,FIREBASE_STAGING_PROJECT_ID:project}});
 const config=JSON.parse(readFileSync('firebase.json','utf8'));
 // Patch redirects only in the generated deploy config: keep public links on the existing staging Worker.
 const worker='https://iaqar-intake-staging.iaqar-ai.workers.dev';
 for(const redirect of config.hosting.redirects||[])if(redirect.destination?.includes('iaqar-macrodroid-intake.iaqar-ai.workers.dev'))redirect.destination=redirect.destination.replace('https://iaqar-macrodroid-intake.iaqar-ai.workers.dev',worker);
 delete config.firestore;delete config.emulators;
 writeFileSync('/tmp/iaqar-tour-hosting-config.json',JSON.stringify({...config,hosting:{...config.hosting,public:process.cwd()+'/public'}},null,2));
 execFileSync('node',['scripts/write-staging-version.mjs'],{stdio:'inherit'});
 execFileSync('npx',['firebase-tools','hosting:channel:deploy','staging','--project',project,'--config','/tmp/iaqar-tour-hosting-config.json','--expires','30d','--non-interactive'],{stdio:'inherit',env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:credential}});
 const after=await version(HOST);const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(after.fullSha!==sha)throw new Error('Published Staging SHA does not match this commit');
 const page=await fetch(HOST+'/tour');if(!page.ok||!(await page.text()).includes('أرغب في تجربة iAqar'))throw new Error('Published tour missing');
 const productionAfter=await version(PROD);if(productionAfter.fullSha!==productionBefore.fullSha)throw new Error('Production SHA changed during verification; investigate concurrent release');
 console.log(`Tour verified on ${HOST}/tour; Production remains ${productionAfter.shortSha}`);
}finally{rmSync(credential,{force:true});rmSync('/tmp/iaqar-tour-hosting-config.json',{force:true});rmSync('public/version.json',{force:true});}
