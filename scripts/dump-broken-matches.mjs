#!/usr/bin/env node
/**
 * Read-only dump of match documents in the live staging office.
 * Does not mutate. Does not deploy.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import {
  classifyHistoricalMatch,
  collectCandidateOpportunityIds
} from "../worker/src/match-integrity-domain.js";
import {
  consumeDailyTaskDiagnostics,
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";

const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const OFFICE_ID = process.env.AUDIT_OFFICE_ID || "staging-logo-live-20260807";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing", parsed.invalidFields || []);
  process.exit(1);
}
const app = admin.initializeApp({
  credential: admin.cert(parsed.serviceAccount),
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

function pick(data = {}, keys = []) {
  const out = {};
  for (const key of keys) out[key] = data[key] ?? "";
  return out;
}

async function main() {
  const office = db.collection("offices").doc(OFFICE_ID);
  const [matchesSnap, oppsSnap, opsSnap] = await Promise.all([
    office.collection("matches").limit(200).get(),
    office.collection("opportunities").limit(400).get(),
    office.collection("operations").limit(200).get()
  ]);

  const docsById = {};
  for (const doc of oppsSnap.docs) {
    docsById[doc.id] = { id: doc.id, ...doc.data() };
  }

  const matchRows = matchesSnap.docs.map((doc) => {
    const data = doc.data() || {};
    const item = {
      id: doc.id,
      ...data,
      createdAt: iso(data.createdAt),
      updatedAt: iso(data.updatedAt)
    };
    const classification = classifyHistoricalMatch({
      officeId: OFFICE_ID,
      ...item
    }, docsById);
    return {
      matchId: doc.id,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdBy: data.createdBy || "",
      source: data.source || data.sourceType || "",
      officeId: data.officeId || OFFICE_ID,
      status: data.status || "",
      isCurrent: data.isCurrent,
      schemaVersion: data.schemaVersion || "",
      requestId: data.requestId || "",
      offerId: data.offerId || "",
      clientRequestId: data.clientRequestId || "",
      ownerOfferId: data.ownerOfferId || "",
      opportunityId: data.opportunityId || "",
      counterpartOpportunityId: data.counterpartOpportunityId || "",
      sourceCollection: data.sourceCollection || "",
      sourceRecordId: data.sourceRecordId || "",
      counterpartCollection: data.counterpartCollection || "",
      counterpartRecordId: data.counterpartRecordId || "",
      matchGroupId: data.matchGroupId || "",
      pairRuleKey: data.pairRuleKey || "",
      canonicalPairKey: data.canonicalPairKey || "",
      matchingRuleVersion: data.matchingRuleVersion || "",
      integrityStatus: data.integrityStatus || "",
      integrityReason: data.integrityReason || "",
      candidateIds: collectCandidateOpportunityIds(item),
      classification
    };
  });

  const matchItems = matchesSnap.docs.map((doc) => {
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
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt || item.createdAt),
      integrityStatus: item.integrityStatus || "",
      integrityReason: item.integrityReason || ""
    };
  });
  const opportunityItems = oppsSnap.docs.map((doc) => {
    const item = doc.data() || {};
    return {
      id: `opp-${doc.id}`,
      recordId: doc.id,
      recordType: "opportunity",
      opportunityId: doc.id,
      opportunityKind: item.opportunityKind || "",
      sourceCollection: item.sourceCollection || "",
      sourceRecordId: item.sourceRecordId || "",
      sourceIntakeId: item.sourceIntakeId || "",
      propertyType: item.propertyType || "",
      purpose: item.purpose || item.transactionType || "",
      district: item.district || "",
      city: item.city || "",
      salePrice: item.salePrice ?? item.price,
      budget: item.budget ?? item.priceMax,
      area: item.area || 0,
      contactPhone: item.contactPhone || item.phone || "",
      createdAt: iso(item.createdAt)
    };
  });
  const operationItems = opsSnap.docs.map((doc) => projectOperationToUiItem({ id: doc.id, ...doc.data() }));

  consumeDailyTaskDiagnostics();
  const mapped = mapOperationsItemsToDailyTasks(
    [...operationItems, ...matchItems, ...opportunityItems],
    new Date(),
    { officeId: OFFICE_ID }
  );
  const hidden = consumeDailyTaskDiagnostics();

  const reasonCounts = {
    missing_requestId: 0,
    missing_offerId: 0,
    unresolved_request: 0,
    unresolved_offer: 0,
    other: 0
  };
  const creatorCounts = {};
  for (const row of hidden) {
    const reasons = row.reasons || [];
    let grouped = false;
    for (const key of ["missing_requestId", "missing_offerId", "unresolved_request", "unresolved_offer"]) {
      if (reasons.includes(key)) {
        reasonCounts[key] += 1;
        grouped = true;
      }
    }
    if (!grouped) reasonCounts.other += 1;
  }
  for (const row of matchRows) {
    const path = `${row.sourceCollection || "?"}→${row.counterpartCollection || "?"} opp=${Boolean(row.opportunityId)} counterpart=${Boolean(row.counterpartOpportunityId)}`;
    creatorCounts[path] = (creatorCounts[path] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    officeId: OFFICE_ID,
    rawMatchCount: matchRows.length,
    opportunityCount: oppsSnap.size,
    operationCount: opsSnap.size,
    visibleSendable: mapped.length,
    invalidTaskData: hidden.length,
    reasonCounts,
    creatorCounts,
    repairable: matchRows.filter((row) => row.classification.class === "REPAIRABLE").length,
    unrepairable: matchRows.filter((row) => row.classification.class === "UNREPAIRABLE").length,
    hidden,
    matches: matchRows,
    opportunityIndex: opportunityItems.map((item) => pick(item, [
      "opportunityId", "opportunityKind", "sourceCollection", "sourceRecordId", "sourceIntakeId",
      "propertyType", "district", "createdAt"
    ]))
  };

  mkdirSync(OUT, { recursive: true });
  mkdirSync("/workspace/qa", { recursive: true });
  writeFileSync(`${OUT}/broken-match-dump.json`, JSON.stringify(report, null, 2));
  writeFileSync("/workspace/qa/broken-match-dump.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    visibleSendable: report.visibleSendable,
    invalidTaskData: report.invalidTaskData,
    reasonCounts: report.reasonCounts,
    creatorCounts: report.creatorCounts,
    repairable: report.repairable,
    unrepairable: report.unrepairable,
    sample: report.matches.slice(0, 3)
  }, null, 2));
  await app.delete();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
