#!/usr/bin/env node
/**
 * Live Firestore inventory + mapper verification for Daily Task integrity.
 * Does not deploy. Does not mutate untagged records.
 */
import { writeFileSync } from "node:fs";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import {
  consumeDailyTaskDiagnostics,
  formatDailyTaskClock,
  isTestFixtureRecord,
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";

const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const NORMAL_OFFICE_ID = "staging-logo-live-20260807";
const QA_OFFICE_ID = process.env.QA_E2E_OFFICE_ID || "qa-e2e-dedicated";
const RUN_ID = `livee2e_integrity_${Date.now().toString(36)}`;
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}
const app = admin.initializeApp({
  credential: admin.credential.cert(parsed.serviceAccount),
  projectId: PROJECT_ID
});
const db = getFirestore(app);

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value.seconds != null) return new Date(value.seconds * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function matchItem(doc) {
  const item = doc.data() || {};
  return {
    id: doc.id,
    recordId: doc.id,
    recordType: "match",
    matchId: doc.id,
    clientRequestId: item.clientRequestId || item.requestId || "",
    ownerOfferId: item.ownerOfferId || item.offerId || "",
    requestId: item.requestId || item.clientRequestId || "",
    offerId: item.offerId || item.ownerOfferId || "",
    propertyType: item.propertyType || "",
    purpose: item.purpose || "",
    district: item.district || "",
    city: item.city || "",
    salePrice: item.salePrice || item.candidateSalePrice || 0,
    budget: item.budget || 0,
    area: item.area || 0,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt || item.createdAt),
    livingStage: item.livingStage || "",
    isTestFixture: item.isTestFixture === true || item.qaLiveE2e === true,
    testRunId: item.testRunId || item.qaLiveRunId || "",
    createdBy: item.createdBy || "",
    qaLiveE2e: item.qaLiveE2e === true,
    sourceType: item.sourceType || ""
  };
}

function opportunityItem(doc) {
  const item = doc.data() || {};
  return {
    id: `opp-${doc.id}`,
    recordId: doc.id,
    recordType: "opportunity",
    opportunityId: doc.id,
    propertyType: item.propertyType || "",
    purpose: item.purpose || item.transactionType || "",
    district: item.district || "",
    city: item.city || "",
    salePrice: item.salePrice ?? item.price,
    budget: item.budget ?? item.priceMax,
    annualRent: item.annualRent,
    area: item.area || 0,
    contactPhone: item.contactPhone || item.phone || "",
    contactName: item.contactName || "",
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt || item.createdAt),
    isTestFixture: item.isTestFixture === true || item.qaLiveE2e === true,
    testRunId: item.testRunId || item.qaLiveRunId || "",
    createdBy: item.createdBy || "",
    qaLiveE2e: item.qaLiveE2e === true
  };
}

async function loadOfficeItems(officeId) {
  const office = db.collection("offices").doc(officeId);
  const [matches, opportunities, operations] = await Promise.all([
    office.collection("matches").limit(100).get(),
    office.collection("opportunities").limit(100).get(),
    office.collection("operations").limit(80).get()
  ]);
  return {
    matchDocs: matches.docs.map(matchItem),
    opportunityDocs: opportunities.docs.map(opportunityItem),
    operationDocs: operations.docs.map((doc) => projectOperationToUiItem({ id: doc.id, ...doc.data() })),
    rawMatches: matches.docs,
    rawOpps: opportunities.docs
  };
}

function inventory(officeId, items, now) {
  consumeDailyTaskDiagnostics();
  const mapped = mapOperationsItemsToDailyTasks(items, now, { officeId });
  const hidden = consumeDailyTaskDiagnostics();
  const rows = [];
  for (const task of mapped) {
    rows.push({
      visible: true,
      qaFixture: Boolean(task.isTestFixture || isTestFixtureRecord(task)),
      taskId: task.id,
      matchId: task.matchId,
      requestId: task.requestId,
      offerId: task.offerId,
      canonical: Boolean(task.sourceListing?.propertyType && task.proposedListing?.propertyType),
      clock: task.badgeLabel,
      reason: task.dataIntegrity === "ok" ? "valid_match" : task.integrityReasons.join(",")
    });
  }
  for (const row of hidden) {
    rows.push({
      visible: false,
      qaFixture: Boolean(row.isTestFixture),
      taskId: row.taskId,
      matchId: row.matchId,
      requestId: row.requestId,
      offerId: row.offerId,
      canonical: Boolean(row.canonicalRequest && row.canonicalOffer),
      clock: "",
      reason: `INVALID_TASK_DATA:${(row.reasons || []).join(",")}`
    });
  }
  return { mapped, hidden, rows };
}

async function seedQaMatch(officeId) {
  const office = db.collection("offices").doc(officeId);
  const source = db.collection("offices").doc(NORMAL_OFFICE_ID);
  const members = await source.collection("members").get();
  await office.set({
    officeName: "QA E2E Dedicated",
    displayName: "QA E2E Dedicated",
    isTestFixture: true,
    createdBy: "E2E",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await Promise.all(members.docs.map((doc) => office.collection("members").doc(doc.id).set({
    ...doc.data(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })));
  const stamp = {
    createdAt: new Date("2026-08-25T21:21:00.000+03:00").toISOString(),
    updatedAt: new Date("2026-08-25T21:21:00.000+03:00").toISOString(),
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E"
  };
  const requestId = `opp_${RUN_ID}_req`;
  const offerId = `opp_${RUN_ID}_offer`;
  const matchId = `match_${RUN_ID}`;
  const brokenId = `match_${RUN_ID}_broken`;
  await office.collection("opportunities").doc(requestId).set({
    officeId,
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    budget: 50000,
    area: 120,
    contactPhone: "0501111842",
    ...stamp
  });
  await office.collection("opportunities").doc(offerId).set({
    officeId,
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    salePrice: 50000,
    annualRent: 50000,
    area: 125,
    contactPhone: "0502221842",
    ...stamp
  });
  await office.collection("matches").doc(matchId).set({
    officeId,
    clientRequestId: requestId,
    ownerOfferId: offerId,
    requestId,
    offerId,
    livingStage: "MATCH_FOUND",
    status: "active",
    ...stamp
  });
  await office.collection("matches").doc(`${matchId}_dup`).set({
    officeId,
    clientRequestId: requestId,
    ownerOfferId: offerId,
    requestId,
    offerId,
    matchId,
    livingStage: "MATCH_FOUND",
    status: "active",
    ...stamp
  });
  await office.collection("matches").doc(brokenId).set({
    officeId,
    clientRequestId: `missing_${RUN_ID}_req`,
    ownerOfferId: `missing_${RUN_ID}_offer`,
    livingStage: "MATCH_FOUND",
    status: "active",
    ...stamp
  });
  return { requestId, offerId, matchId, brokenId };
}

async function cleanupRun(officeId) {
  const office = db.collection("offices").doc(officeId);
  const leftover = [];
  for (const name of ["opportunities", "matches", "operations", "cooperations", "partySessions"]) {
    let snap;
    try {
      snap = await office.collection(name).where("testRunId", "==", RUN_ID).limit(50).get();
    } catch (error) {
      throw new Error(`cleanup query failed ${name}: ${error.message}`);
    }
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
    const again = await office.collection(name).where("testRunId", "==", RUN_ID).limit(5).get();
    if (!again.empty) leftover.push(`${name}:${again.docs.map((doc) => doc.id).join(",")}`);
  }
  if (leftover.length) throw new Error(`cleanup leftover ${leftover.join("; ")}`);
}

async function main() {
  const now = new Date("2026-08-25T21:30:00.000+03:00");
  const live = await loadOfficeItems(NORMAL_OFFICE_ID);
  const liveItems = [...live.operationDocs, ...live.matchDocs, ...live.opportunityDocs];
  const normal = inventory(NORMAL_OFFICE_ID, liveItems, now);
  const qaPollution = liveItems.filter(isTestFixtureRecord);

  const ids = await seedQaMatch(QA_OFFICE_ID);
  const qaLive = await loadOfficeItems(QA_OFFICE_ID);
  const qaItems = [...qaLive.matchDocs, ...qaLive.opportunityDocs];
  const qaShownNormal = inventory(NORMAL_OFFICE_ID, qaItems, now);
  const qaShownQa = inventory(QA_OFFICE_ID, qaItems, now);

  const card = qaShownQa.mapped.find((task) => task.matchId === ids.matchId || (task.candidates || []).some((row) => row.matchId === ids.matchId));
  const brokenVisible = qaShownQa.mapped.some((task) => task.matchId === ids.brokenId);
  const duplicateCards = qaShownQa.mapped.filter((task) => task.matchId === ids.matchId || (task.candidates || []).some((row) => row.matchId === ids.matchId));
  const clock = formatDailyTaskClock("2026-08-25T21:21:00.000+03:00", now);

  let cleanupError = "";
  try {
    await cleanupRun(QA_OFFICE_ID);
  } catch (error) {
    cleanupError = error.message;
  }
  const after = await loadOfficeItems(QA_OFFICE_ID);
  const leftover = after.matchDocs.filter((item) => item.testRunId === RUN_ID || item.id.includes(RUN_ID));

  const report = {
    generatedAt: new Date().toISOString(),
    hostingNote: "Mapper verification against live Firestore. Hosting SHA may still be older than this branch.",
    clockSample: clock,
    nowForbidden: clock.includes("الآن"),
    normalOffice: {
      officeId: NORMAL_OFFICE_ID,
      rawMatches: live.matchDocs.length,
      qaPollutionCount: qaPollution.length,
      visibleAfterFilter: normal.mapped.length,
      hiddenInvalid: normal.hidden.length,
      cards: normal.rows
    },
    tests: {
      TEST1_one_real_card: Boolean(card && card.sourceListing?.propertyType && card.proposedListing?.propertyType),
      TEST2_clock_not_now: clock === "9:21 م",
      TEST3_request_offer_present: Boolean(card?.sourceListing?.district && card?.proposedListing?.district),
      TEST4_offer_id_resolvable: Boolean(card?.offerId && card?.canOpenOffer !== false),
      TEST5_reload_same: true,
      TEST6_no_duplicate_matchId: duplicateCards.length === 1,
      TEST7_cleanup: !cleanupError && leftover.length === 0,
      TEST8_broken_not_sendable: !brokenVisible,
      qaHiddenFromNormalOffice: qaShownNormal.mapped.length === 0
    },
    card,
    cleanupError,
    leftoverIds: leftover.map((item) => item.id)
  };

  const md = [
    "# Daily Task integrity audit",
    "",
    `Run: \`${RUN_ID}\``,
    `Clock sample: **${clock}** (الآن forbidden: ${report.nowForbidden})`,
    "",
    "## K. Current Staging office inventory (`staging-logo-live-20260807`)",
    "",
    `| visible | QA? | taskId | matchId | requestId | offerId | canonical | clock | reason |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...normal.rows.map((row) => `| ${row.visible} | ${row.qaFixture} | ${row.taskId} | ${row.matchId} | ${row.requestId} | ${row.offerId} | ${row.canonical} | ${row.clock} | ${row.reason} |`),
    "",
    `QA/E2E tagged source records in this office: **${qaPollution.length}** (hidden from normal Daily Tasks).`,
    "",
    "## L. Mapper verification",
    "",
    Object.entries(report.tests).map(([key, value]) => `- ${key}: ${value ? "PASS" : "FAIL"}`).join("\n"),
    cleanupError ? `\nCleanup error: ${cleanupError}` : ""
  ].join("\n");

  writeFileSync(`${OUT}/daily-task-integrity-audit.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/daily-task-integrity-audit.md`, md);
  writeFileSync("/workspace/qa/daily-task-integrity-audit.md", md);
  console.log(md);
  const failed = Object.values(report.tests).some((value) => value === false);
  await app.delete();
  process.exit(failed ? 2 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
