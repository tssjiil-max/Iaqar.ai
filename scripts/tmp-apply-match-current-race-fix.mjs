import fs from "node:fs";

const indexPath = "worker/src/index.js";
const atomicPath = "worker/src/firestore-atomic-write-service.js";
const claimPath = "worker/src/match-current-claim-service.js";
const packagePath = "worker/package.json";

const claimService = `function isClaimConflict(error) {
  const code = String(error?.code || error?.firestoreCode || "").toUpperCase();
  const message = String(error?.message || "").toUpperCase();
  return code === "ABORTED"
    || code === "FAILED_PRECONDITION"
    || message.includes("ABORTED")
    || message.includes("FAILED_PRECONDITION");
}

export async function claimCurrentMatchForPairRule({
  pairRuleKey,
  targetMatchId,
  loadSnapshot,
  commitClaim,
  maxAttempts = 5
}) {
  if (!pairRuleKey) throw new Error("pairRuleKey is required");
  if (!targetMatchId) throw new Error("targetMatchId is required");
  if (typeof loadSnapshot !== "function") throw new Error("loadSnapshot is required");
  if (typeof commitClaim !== "function") throw new Error("commitClaim is required");
  const attemptsLimit = Math.max(1, Math.min(10, Number(maxAttempts) || 5));

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    const snapshot = await loadSnapshot({ pairRuleKey, targetMatchId, attempt });
    const currentMatches = Array.isArray(snapshot?.currentMatches) ? snapshot.currentMatches : [];
    const pointer = snapshot?.pointer || null;
    const supersededMatchIds = [...new Set([
      ...currentMatches
        .filter(match => String(match?.pairRuleKey || "") === String(pairRuleKey))
        .filter(match => match?.isCurrent !== false && String(match?.status || "") !== "superseded")
        .map(match => String(match?.matchId || ""))
        .filter(matchId => matchId && matchId !== targetMatchId),
      pointer?.currentMatchId && pointer.currentMatchId !== targetMatchId ? String(pointer.currentMatchId) : ""
    ].filter(Boolean))];

    try {
      await commitClaim({
        pairRuleKey,
        targetMatchId,
        supersededMatchIds,
        pointer,
        attempt
      });
      return { pairRuleKey, targetMatchId, supersededMatchIds, attempts: attempt };
    } catch (error) {
      if (!isClaimConflict(error) || attempt >= attemptsLimit) throw error;
    }
  }

  throw new Error("current match claim attempts exhausted");
}
`;
fs.writeFileSync(claimPath, claimService);

let atomic = fs.readFileSync(atomicPath, "utf8");
atomic = atomic.replace(
  'export function buildFirestoreUpdateWrite({ projectId, segments, fields }) {',
  'export function buildFirestoreUpdateWrite({ projectId, segments, fields, precondition = null }) {'
);
const oldReturn = `  return {
    update: {
      name: firestoreDocumentName(projectId, segments),
      fields: compacted
    },
    updateMask: { fieldPaths }
  };`;
const newReturn = `  const write = {
    update: {
      name: firestoreDocumentName(projectId, segments),
      fields: compacted
    },
    updateMask: { fieldPaths }
  };
  if (precondition) {
    if (typeof precondition.updateTime === "string" && precondition.updateTime) {
      write.currentDocument = { updateTime: precondition.updateTime };
    } else if (typeof precondition.exists === "boolean") {
      write.currentDocument = { exists: precondition.exists };
    } else {
      throw new Error("Firestore write precondition must use updateTime or exists");
    }
  }
  return write;`;
if (!atomic.includes(oldReturn)) throw new Error("atomic write return anchor not found");
atomic = atomic.replace(oldReturn, newReturn);
const oldError = `  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(\`Firestore atomic commit failed (\${response.status}): \${detail}\`);
  }`;
const newError = `  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let firestoreCode = "";
    try {
      firestoreCode = String(JSON.parse(detail)?.error?.status || "");
    } catch {}
    const error = new Error(\`Firestore atomic commit failed (\${response.status}): \${detail}\`);
    error.status = response.status;
    error.firestoreCode = firestoreCode;
    error.code = firestoreCode || String(response.status || "");
    throw error;
  }`;
if (!atomic.includes(oldError)) throw new Error("atomic error anchor not found");
atomic = atomic.replace(oldError, newError);
fs.writeFileSync(atomicPath, atomic);

let source = fs.readFileSync(indexPath, "utf8");
const atomicImport = 'import { buildFirestoreUpdateWrite, commitFirestoreWrites } from "./firestore-atomic-write-service.js";';
const claimImport = 'import { claimCurrentMatchForPairRule } from "./match-current-claim-service.js";';
if (!source.includes(claimImport)) {
  if (!source.includes(atomicImport)) throw new Error("atomic import anchor not found");
  source = source.replace(atomicImport, `${atomicImport}\n${claimImport}`);
}

const supersedeStart = source.indexOf("async function supersedeMatchesForPairKey({");
const supersedeEnd = source.indexOf("async function loadOpportunityDocsByIds({", supersedeStart);
if (supersedeStart < 0 || supersedeEnd <= supersedeStart) throw new Error("supersedeMatchesForPairKey block not found");
source = source.slice(0, supersedeStart) + source.slice(supersedeEnd);

const persistStart = source.indexOf("async function persistScoredMatch({");
const persistEnd = source.indexOf("\nasync function ", persistStart + 10);
if (persistStart < 0 || persistEnd <= persistStart) throw new Error("persistScoredMatch block not found");
let persist = source.slice(persistStart, persistEnd);

const oldSupersedeCall = `  await supersedeMatchesForPairKey({
    projectId, officeId, pairRule, keepMatchId: matchId, accessToken
  });

`;
if (!persist.includes(oldSupersedeCall)) throw new Error("persist supersede call not found");
persist = persist.replace(oldSupersedeCall, "");

const readinessAnchor = "  const readiness = scored.readiness;";
const readinessIndex = persist.indexOf(readinessAnchor);
if (readinessIndex < 0) throw new Error("readiness anchor not found");
const afterReadiness = persist.slice(readinessIndex + readinessAnchor.length);
const matchWritePattern = /\n\n  await setFirestoreDocument\(\{ projectId, segments: \["offices", officeId, "matches", matchId\], accessToken, fields: \{\n([\s\S]*?)\n  \}\}\);/;
const matchWrite = afterReadiness.match(matchWritePattern);
if (!matchWrite) throw new Error("new match write block not found");
const matchFieldBody = matchWrite[1];

const claimBlock = `

  const matchFields={
${matchFieldBody}
  };
  const claim=await claimCurrentMatchForPairRule({
    pairRuleKey: pairRule,
    targetMatchId: matchId,
    maxAttempts: 5,
    loadSnapshot: async () => {
      const pointerDoc=await getFirestoreDocument({
        projectId, segments:["offices",officeId,"matchCurrentPointers",pairRule], accessToken, allowMissing:true
      });
      if(pointerDoc && !pointerDoc.updateTime) throw new Error("current match pointer is missing updateTime");
      const pointerData=pointerDoc?firestoreFieldsToJs(pointerDoc.fields||{}):null;
      const docs=await listCollectionDocuments({
        projectId, segments:["offices",officeId,"matches"], accessToken, pageSize:MAX_MATCH_CANDIDATES
      });
      const currentMatches=docs.map(doc=>{
        const data=firestoreFieldsToJs(doc.fields||{});
        const currentMatchId=decodeURIComponent(String(doc.name||"").split("/").pop()||"");
        return {...data,matchId:currentMatchId};
      });
      return {
        pointer:pointerDoc?{currentMatchId:String(pointerData?.currentMatchId||""),updateTime:pointerDoc.updateTime}:null,
        currentMatches
      };
    },
    commitClaim: async ({targetMatchId,supersededMatchIds,pointer}) => {
      const writes=[];
      for(const supersededMatchId of supersededMatchIds){
        writes.push(buildFirestoreUpdateWrite({
          projectId,
          segments:["offices",officeId,"matches",supersededMatchId],
          fields:{
            isCurrent:firestoreBoolean(false),
            status:firestoreString("superseded"),
            statusLabel:firestoreString("أُلغيت بنسخة أحدث"),
            supersededAt:firestoreTimestamp(now),
            supersededByMatchId:firestoreString(targetMatchId),
            attentionRequired:firestoreBoolean(false),
            updatedAt:firestoreTimestamp(now)
          }
        }));
      }
      writes.push(buildFirestoreUpdateWrite({
        projectId, segments:["offices",officeId,"matches",targetMatchId], fields:matchFields
      }));
      writes.push(buildFirestoreUpdateWrite({
        projectId,
        segments:["offices",officeId,"matchCurrentPointers",pairRule],
        fields:{
          schemaVersion:firestoreInteger(1),
          officeId:firestoreString(officeId),
          pairRuleKey:firestoreString(pairRule),
          currentMatchId:firestoreString(targetMatchId),
          matchingRuleVersion:firestoreString(MATCHING_RULE_VERSION),
          updatedAt:firestoreTimestamp(now)
        },
        precondition:pointer?{updateTime:pointer.updateTime}:{exists:false}
      }));
      await commitFirestoreWrites({projectId,accessToken,writes});
    }
  });
  if(claim.supersededMatchIds.length){
    await expireOperationsForMatchIds({
      projectId,
      officeId,
      matchIds:claim.supersededMatchIds,
      accessToken,
      listCollectionDocuments,
      setFirestoreDocument,
      firestoreHelpers:operationsFirestoreHelpers()
    }).catch((error)=>console.warn("[iaqar-ops] expire superseded match ops",error&&error.message));
  }`;

const replacedAfterReadiness = afterReadiness.replace(matchWritePattern, claimBlock);
if (replacedAfterReadiness === afterReadiness) throw new Error("match write replacement failed");
persist = persist.slice(0, readinessIndex + readinessAnchor.length) + replacedAfterReadiness;
source = source.slice(0, persistStart) + persist + source.slice(persistEnd);
fs.writeFileSync(indexPath, source);

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const raceTest = "node test/match-current-race.test.mjs";
if (!pkg.scripts.test.includes(raceTest)) pkg.scripts.test = `${raceTest} && ${pkg.scripts.test}`;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log("applied pairRule current-match CAS fix");
