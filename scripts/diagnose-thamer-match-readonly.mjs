import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { mapOperationsItemsToDailyTasks, consumeDailyTaskDiagnostics } from "../src/v2/content/daily-tasks/domain.js";

const PROJECT_ID = "iaqar-ai-staging";
const OFFICE_ID = "thamer";

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const office = db.collection("offices").doc(OFFICE_ID);

const matchesSnap = await office.collection("matches").orderBy("createdAt", "desc").limit(30).get();
const matches = matchesSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((m) => m.isTestFixture !== true && m.qaLiveE2e !== true);
const match = matches.find((m) => {
  const s = String(m.status || "").toLowerCase();
  return m.isCurrent !== false && !["superseded","completed","closed"].includes(s);
}) || matches[0];

if (!match) {
  console.log("matchId: NONE\nMATCH_REVIEW created: NO\noperationId: NONE\nofficeId: thamer\nassignedBrokerId: NONE\nstatus: NONE\nreaches daily-tasks source: NO\nfailure point: no real match found\nfile: worker/src/index.js\nfunction: persistScoredMatch");
  process.exit(0);
}

const matchId = match.id;
const opsSnap = await office.collection("operations").where("matchId", "==", matchId).limit(20).get();
const operations = opsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
const op = operations.find((row) => String(row.type || "").toUpperCase() === "MATCH_REVIEW") || null;

let reaches = false;
let failurePoint = "";
let file = "";
let fn = "";

if (!op) {
  failurePoint = "MATCH exists but MATCH_REVIEW is missing";
  file = "worker/src/index.js";
  fn = "ensurePersistedMatchReviewOperation / persistScoredMatch";
} else {
  const projected = projectOperationToUiItem(op);
  consumeDailyTaskDiagnostics();
  const mapped = mapOperationsItemsToDailyTasks([projected], new Date(), { officeId: OFFICE_ID });
  const diagnostics = consumeDailyTaskDiagnostics();
  reaches = mapped.some((task) => String(task.matchId || "") === matchId || (task.candidates || []).some((c) => String(c.matchId || "") === matchId));
  if (!reaches) {
    failurePoint = diagnostics.length ? JSON.stringify(diagnostics) : "dropped by daily-task mapper";
    file = "src/v2/content/daily-tasks/domain.js";
    fn = "mapOperationsItemsToDailyTasks";
  } else {
    failurePoint = "none in data mapping; failure is after source projection";
    file = "public/js/workflow-office.js";
    fn = "startLiveData / emitOperations";
  }
}

console.log(`matchId: ${matchId}`);
console.log(`MATCH_REVIEW created: ${op ? "YES" : "NO"}`);
console.log(`operationId: ${op?.id || "NONE"}`);
console.log(`officeId: ${op?.officeId || match.officeId || OFFICE_ID}`);
console.log(`assignedBrokerId: ${op?.assignedBrokerId || match.assignedBrokerId || "NONE"}`);
console.log(`status: ${op?.status || match.status || "NONE"}`);
console.log(`reaches daily-tasks source: ${reaches ? "YES" : "NO"}`);
console.log(`failure point: ${failurePoint}`);
console.log(`file: ${file}`);
console.log(`function: ${fn}`);
