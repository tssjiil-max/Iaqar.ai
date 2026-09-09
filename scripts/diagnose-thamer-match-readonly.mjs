import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { mapOperationsItemsToDailyTasks, consumeDailyTaskDiagnostics } from "../src/v2/content/daily-tasks/domain.js";

const PROJECT_ID = "iaqar-ai-staging";
const SLUG = "thamer";

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const claimSnap = await db.collection("officeSlugClaims").doc(SLUG).get();
const claim = claimSnap.exists ? (claimSnap.data() || {}) : {};
const OFFICE_ID = String(claim.officeId || "").trim();
console.log("slug:", SLUG);
console.log("resolvedOfficeId:", OFFICE_ID || "NONE");
if (!OFFICE_ID) process.exit(0);

const office = db.collection("offices").doc(OFFICE_ID);
const matchSnap = await office.collection("matches").orderBy("createdAt","desc").limit(10).get();
const realMatches = matchSnap.docs
  .map(d=>({id:d.id,...(d.data()||{})}))
  .filter(x=>x.isTestFixture!==true && x.qaLiveE2e!==true);
const match = realMatches[0] || null;

if (!match) {
  console.log("matchId: NONE");
  process.exit(0);
}

const matchId = match.id;
const opsSnap = await office.collection("operations").where("matchId","==",matchId).limit(20).get();
const ops = opsSnap.docs.map(d=>({id:d.id,...(d.data()||{})}));
const review = ops.find(x=>String(x.type||"").toUpperCase()==="MATCH_REVIEW") || null;

console.log("matchId:", matchId);
console.log("requestId:", match.requestId || match.clientRequestId || "");
console.log("offerId:", match.offerId || match.ownerOfferId || "");
console.log("matchStatus:", match.status || "");
console.log("matchScore:", match.score ?? "");
console.log("matchOperationIdField:", match.operationId || "");
console.log("MATCH_REVIEW created:", review ? "YES":"NO");
console.log("operationId:", review?.id || "NONE");
console.log("operationType:", review?.type || "NONE");
console.log("operationStatus:", review?.status || "NONE");
console.log("assignedBrokerId:", review?.assignedBrokerId || match.assignedBrokerId || "NONE");
console.log("operationOfficeId:", review?.officeId || "NONE");

if (review) {
  const projected = projectOperationToUiItem(review);
  consumeDailyTaskDiagnostics();
  const mapped = mapOperationsItemsToDailyTasks([projected], new Date(), {officeId:OFFICE_ID});
  const diags = consumeDailyTaskDiagnostics();
  console.log("projectedRecordType:", projected.recordType || "");
  console.log("projectedOperationType:", projected.operationType || "");
  console.log("projectedMatchId:", projected.matchId || "");
  console.log("projectedRequestId:", projected.requestId || projected.clientRequestId || "");
  console.log("projectedOfferId:", projected.offerId || projected.ownerOfferId || "");
  console.log("mappedTaskCount:", mapped.length);
  console.log("mappedTaskIds:", mapped.map(x=>x.id).join(",") || "NONE");
  console.log("mapperDiagnostics:", JSON.stringify(diags));
}
