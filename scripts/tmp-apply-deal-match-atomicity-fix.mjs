import fs from "node:fs";

const indexPath = "worker/src/index.js";
const packagePath = "worker/package.json";
const servicePath = "worker/src/firestore-atomic-write-service.js";

const serviceSource = `function compactFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));
}

function firestoreDocumentName(projectId, segments) {
  const documentPath = segments.map(segment => String(segment)).join("/");
  return \`projects/\${projectId}/databases/(default)/documents/\${documentPath}\`;
}

export function buildFirestoreUpdateWrite({ projectId, segments, fields }) {
  if (!projectId) throw new Error("Firestore projectId is required");
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("Firestore document path is required");
  const compacted = compactFields(fields);
  const fieldPaths = Object.keys(compacted);
  if (fieldPaths.length === 0) throw new Error("Firestore update fields are required");
  return {
    update: {
      name: firestoreDocumentName(projectId, segments),
      fields: compacted
    },
    updateMask: { fieldPaths }
  };
}

export async function commitFirestoreWrites({ projectId, accessToken, writes, fetchImpl = fetch }) {
  if (!projectId) throw new Error("Firestore projectId is required");
  if (!accessToken) throw new Error("Firestore access token is required");
  if (!Array.isArray(writes) || writes.length < 2) throw new Error("Firestore atomic commit requires multiple writes");
  const endpoint = \`https://firestore.googleapis.com/v1/projects/\${encodeURIComponent(projectId)}/databases/(default)/documents:commit\`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: \`Bearer \${accessToken}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(\`Firestore atomic commit failed (\${response.status}): \${detail}\`);
  }
  return response.json().catch(() => ({}));
}
`;
fs.writeFileSync(servicePath, serviceSource);

let source = fs.readFileSync(indexPath, "utf8");
const importAnchor = `import { appendCoordinationEvent } from "../../public/js/coordination-session-domain.js";`;
const atomicImport = `import { buildFirestoreUpdateWrite, commitFirestoreWrites } from "./firestore-atomic-write-service.js";`;
if (!source.includes(atomicImport)) {
  if (!source.includes(importAnchor)) throw new Error("atomic import anchor not found");
  source = source.replace(importAnchor, `${atomicImport}\n${importAnchor}`);
}

const start = source.indexOf("async function createDealFromMatch(");
const end = source.indexOf("async function finalizeDealAndCloseSiblings(", start);
if (start < 0 || end <= start) throw new Error("createDealFromMatch block not found");

const replacement = `async function createDealFromMatch({projectId,officeId,matchId,matchData,identity,accessToken,now,commissionExpected=0,startStage="negotiation"}) {
  const dealId=matchData.dealId || \`deal_\${matchId.replace(/^mat_/,"")}\`;
  const stage=DEAL_STAGE_ORDER.includes(startStage)?startStage:"contact";
  const health=calculateDealHealth({stage,status:"open",updatedAt:now});
  const dealFields={
    schemaVersion:firestoreInteger(5),officeId:firestoreString(officeId),dealId:firestoreString(dealId),matchId:firestoreString(matchId),
    clientRequestId:firestoreOptionalString(matchData.clientRequestId),ownerOfferId:firestoreOptionalString(matchData.ownerOfferId),matchGroupId:firestoreOptionalString(matchData.matchGroupId||matchData.clientRequestId),
    status:firestoreString("open"),workflowStage:firestoreString(stage),stageLabel:firestoreString(DEAL_STAGE_LABELS[stage]),
    nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS[stage]),healthScore:firestoreInteger(health.score),healthKey:firestoreString(health.key),healthLabel:firestoreString(health.label),
    score:matchData.score?firestoreInteger(matchData.score):null,closingReadinessScore:matchData.closingReadinessScore?firestoreInteger(matchData.closingReadinessScore):null,
    priority:firestoreOptionalString(matchData.priority),district:firestoreOptionalString(matchData.district),propertyType:firestoreOptionalString(matchData.propertyType),
    assignedToUid:firestoreOptionalString(identity.uid),commissionExpected:commissionExpected?firestoreInteger(Number(commissionExpected)):null,
    brokerageContractRequired:firestoreBoolean(true),brokerageContractStatus:firestoreString(BROKERAGE_CONTRACT_STATUS.NOT_STARTED),brokerageContractReference:firestoreString(""),
    nextFollowUpAt:firestoreTimestamp(defaultNextFollowUp(stage==="closing"?8:24)),followUpCount:firestoreInteger(0),
    createdAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)
  };
  const matchFields={
    status:firestoreString("negotiation"),statusLabel:firestoreString(MATCH_STATUS_LABELS.negotiation),workflowStage:firestoreString("negotiation"),
    nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS.negotiation),dealId:firestoreString(dealId),updatedAt:firestoreTimestamp(now)
  };
  await commitFirestoreWrites({projectId,accessToken,writes:[
    buildFirestoreUpdateWrite({projectId,segments:["offices",officeId,"deals",dealId],fields:dealFields}),
    buildFirestoreUpdateWrite({projectId,segments:["offices",officeId,"matches",matchId],fields:matchFields})
  ]});
  await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:dealId,eventType:"deal_created",stage,note:"تم إنشاء الصفقة من المطابقة",identity,accessToken,createdAt:now});
  await runRuntimeOrchestration({
    event: ORCHESTRATOR_EVENT.DEAL_CREATED,
    officeId, entityId: dealId, occurrenceId: "created",
    context: { projectId, dealId },
    adapters: {
      [ORCHESTRATOR_OWNER.TASKS]: async () => {
        await observeDealCoverageShadow({ projectId, officeId, dealId, accessToken, source: "deal_created" });
        return { ok: true };
      }
    }
  });
  return dealId;
}

`;
source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(indexPath, source);

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const atomicTest = "node test/deal-match-atomicity.test.mjs";
if (!pkg.scripts.test.includes(atomicTest)) pkg.scripts.test = `${atomicTest} && ${pkg.scripts.test}`;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log("applied deal-match atomicity fix");
