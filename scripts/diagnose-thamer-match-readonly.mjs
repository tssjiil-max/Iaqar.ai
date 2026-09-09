import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "iaqar-ai-staging";
const OFFICE_ID = "thamer";

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const office = db.collection("offices").doc(OFFICE_ID);

function ts(v) {
  if (!v) return "";
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return String(v);
}
function pickOpp(doc) {
  const x = doc.data() || {};
  return {
    id: doc.id,
    opportunityKind: x.opportunityKind || x.kind || "",
    purpose: x.purpose || x.transactionType || "",
    propertyType: x.propertyType || "",
    city: x.city || "",
    district: x.district || "",
    lifecycleStatus: x.lifecycleStatus || "",
    status: x.status || "",
    matchingReadiness: x.matchingReadiness || "",
    completeness: x.completeness ?? x.dataCompleteness ?? "",
    budget: x.budget ?? x.priceMax ?? "",
    salePrice: x.salePrice ?? x.price ?? "",
    annualRent: x.annualRent ?? "",
    area: x.area ?? "",
    rooms: x.rooms ?? "",
    sourceRecordId: x.sourceRecordId || "",
    sourceCollection: x.sourceCollection || "",
    createdAt: ts(x.createdAt),
    updatedAt: ts(x.updatedAt)
  };
}
function pickIntake(doc) {
  const x = doc.data() || {};
  return {
    id: doc.id,
    kind: x.kind || "",
    transactionType: x.transactionType || "",
    propertyType: x.propertyType || "",
    city: x.city || "",
    district: x.district || "",
    status: x.status || "",
    processingState: x.processingState || "",
    opportunityId: x.opportunityId || "",
    processedRecordId: x.processedRecordId || "",
    matchCount: x.matchCount ?? "",
    lifecycleStatus: x.lifecycleStatus || "",
    createdAt: ts(x.createdAt),
    updatedAt: ts(x.updatedAt),
    processedAt: ts(x.processedAt)
  };
}

const [oppSnap, intakeSnap, matchSnap, diagSnap] = await Promise.all([
  office.collection("opportunities").orderBy("createdAt", "desc").limit(10).get(),
  office.collection("publicIntake").orderBy("createdAt", "desc").limit(10).get(),
  office.collection("matches").orderBy("createdAt", "desc").limit(10).get(),
  office.collection("matchDiagnostics").orderBy("createdAt", "desc").limit(10).get().catch(() => ({ docs: [] }))
]);

const opps = oppSnap.docs.map(pickOpp).filter(x => !String(x.id).includes("livee2e"));
const intakes = intakeSnap.docs.map(pickIntake);
const matches = matchSnap.docs.map(d => ({ id:d.id, status:d.data()?.status || "", createdAt:ts(d.data()?.createdAt), requestId:d.data()?.requestId || d.data()?.clientRequestId || "", offerId:d.data()?.offerId || d.data()?.ownerOfferId || "" }));
const diags = diagSnap.docs.map(d => ({ id:d.id, ...(d.data() || {}) })).map(x => ({
  id:x.id,
  integrityStatus:x.integrityStatus || "",
  integrityReason:x.integrityReason || "",
  detailsJson:x.detailsJson || "",
  createdAt:ts(x.createdAt)
}));

console.log("LATEST_OPPORTUNITIES");
for (const x of opps.slice(0,6)) console.log(JSON.stringify(x));
console.log("LATEST_PUBLIC_INTAKE");
for (const x of intakes.slice(0,6)) console.log(JSON.stringify(x));
console.log("LATEST_MATCHES");
for (const x of matches.slice(0,6)) console.log(JSON.stringify(x));
console.log("LATEST_MATCH_DIAGNOSTICS");
for (const x of diags.slice(0,6)) console.log(JSON.stringify(x));

const recentIntakes = intakes.slice(0,2);
const linkedOppIds = recentIntakes.map(x => x.opportunityId).filter(Boolean);
const linkedOpps = opps.filter(x => linkedOppIds.includes(x.id));

let failure = "undetermined";
if (recentIntakes.length && recentIntakes.every(x => Number(x.matchCount || 0) === 0)) {
  failure = "publicIntake completed with matchCount=0; persistScoredMatch was never reached for a successful candidate";
}
if (diags[0]?.integrityReason) {
  failure = "matching candidate reached canonical-linkage validation and was rejected: " + diags[0].integrityReason;
}
if (linkedOpps.length < linkedOppIds.length) {
  failure = "publicIntake points to opportunityId that is not present/readable in latest opportunities";
}

console.log("DIAGNOSIS");
console.log("recentIntakeIds:", recentIntakes.map(x=>x.id).join(",") || "NONE");
console.log("linkedOpportunityIds:", linkedOppIds.join(",") || "NONE");
console.log("failure:", failure);
