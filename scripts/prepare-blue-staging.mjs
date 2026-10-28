import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(process.argv[2] || '.');
if (process.env.FIREBASE_PROJECT_ID !== 'iaqar-ai-staging') throw Error('Staging target required');
const replacements = [
  ['https://iaqar-macrodroid-intake.iaqar-ai.workers.dev', 'https://iaqar-intake-staging.iaqar-ai.workers.dev'],
  ['aqar-b5d76', 'iaqar-ai-staging']
];
function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const p=join(dir,name), stat=lstatSync(p);
    if(stat.isSymbolicLink()) throw Error('Symlink rejected: '+p);
    return stat.isDirectory() ? files(p) : [p];
  });
}
const targets = [...files(join(root,'public')).filter(p => /\.(js|mjs|html|css|json|webmanifest|txt|xml|svg)$/i.test(p)),join(root,'firebase.json'),join(root,'.firebaserc')];
let changed=0;
for (const p of targets) {
  const before=readFileSync(p,'utf8');
  let after=before;
  for(const [from,to] of replacements) after=after.replaceAll(from,to);
  if(after!==before){writeFileSync(p,after);changed++;}
}
for(const p of targets){
  const body=readFileSync(p,'utf8');
  for(const [from] of replacements) if(body.includes(from)) throw Error('Production reference: '+p);
}
const config=JSON.parse(readFileSync(join(root,'firebase.json'),'utf8'));
if(config.hosting.public!=='public') throw Error('Unexpected hosting root');
const index=readFileSync(join(root,'public/index.html'),'utf8');
if(!index.includes('src="/__/firebase/init.js"')) throw Error('Same-host Firebase initialization required');
const runtime=readFileSync(join(root,'public/js/runtime-config.js'),'utf8');
if(!runtime.includes('https://iaqar-intake-staging.iaqar-ai.workers.dev')) throw Error('Missing staging worker');
writeFileSync(join(root,'.firebaserc'),JSON.stringify({projects:{default:'iaqar-ai-staging',staging:'iaqar-ai-staging'}},null,2)+'\n');
writeFileSync(join(root,'public/staging-release.json'),JSON.stringify({environment:'staging',projectId:'iaqar-ai-staging',sourceSha:process.env.SOURCE_SHA,identity:'blue-3d-office'},null,2)+'\n');
console.log('Staging isolation PASS; transformed files: '+changed);
