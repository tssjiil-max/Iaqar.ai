#!/usr/bin/env node
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT_ID = "iaqar-ai-staging";
const EXPECTED_OFFICE_ID = "thamer";
const TARGET_PHONE = "0552019909";
const TARGET_BUDGET = 123;

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("STAGING_READ_ACCESS_UNAVAILABLE");
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
  if (value.seconds != null) return new Date(Number(value.seconds) * 1000).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function matchIds(data = {}) {
  const metadata = data.metadata || {};
  return {
    requestId: String(data.clientRequestId || data.requestId || metadata.clientRequestId || metadata.requestId || ""),
    offerId: String(data.ownerOfferId || data.offerId || metadata.ownerOfferId || metadata.offerId || "")
  };
}

function opportunityMatchesScreenshot(data = {}) {
  const phones = [
    data.contactPhone,
    data.phone,
    data.advertiserPhone,
    data.advertiserPhoneNormalized,
    data.contactPhoneNormalized,
    data.contact?.phone,
    data.advertiser?.phone
  ];
  const targetDigits = digits(TARGET_PHONE);
  const phoneHit = phones.some((value) => {
    const candidate = digits(value);
    return candidate && (candidate.endsWith(targetDigits) || targetDigits.endsWith(candidate));
  });
  const budgetValues = [data.budget, data.priceMax, data.priceOrBudget, data.maxPrice, data.salePrice, data.price];
  const budgetHit = budgetValues.some((value) => Number(value) === TARGET_BUDGET);
  return phoneHit || budgetHit;
}

function describeOpportunity(doc) {
  const data = doc.data() || {};
  const officeRef = doc.ref.parent.parent;
  return {
    id: doc.id,
    path: doc.ref.path,
    officeId: officeRef?.id || "",
    officePath: officeRef?.path || "",
    kind: String(data.opportunityKind || data.kind || ""),
    lifecycleStatus: String(data.lifecycleStatus || data.status || ""),
    matchingReadiness: String(data.matchingReadiness || ""),
    contactPhone: String(data.contactPhone || data.phone || data.advertiserPhoneNormalized || data.contactPhoneNormalized || ""),
    budget: data.budget ?? data.priceMax ?? data.priceOrBudget ?? data.maxPrice ?? null,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt)
  };
}

async function inspectOffice(officeRef, targetOpportunityIds) {
  const [matchesSnap, operationsSnap, opportunitiesSnap] = await Promise.all([
    officeRef.collection("matches").orderBy("createdAt", "desc").limit(200).get(),
    officeRef.collection("operations").limit(1000).get(),
    officeRef.collection("opportunities").limit(2000).get()
  ]);

  const operations = operationsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const opportunities = opportunitiesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const matches = matchesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

  const linkedMatches = matches.filter((match) => {
    const pair = matchIds(match);
    return targetOpportunityIds.has(pair.requestId) || targetOpportunityIds.has(pair.offerId);
  }).map((match) => {
    const pair = matchIds(match);
    const linkedOps = operations.filter((op) => String(op.matchId || op.metadata?.matchId || "") === match.id);
    return {
      matchId: match.id,
      createdAt: iso(match.createdAt),
      updatedAt: iso(match.updatedAt),
      status: String(match.status || ""),
      integrityStatus: String(match.integrityStatus || ""),
      requestId: pair.requestId,
      offerId: pair.offerId,
      operationIdOnMatch: String(match.operationId || ""),
      linkedOperations: linkedOps.map((op) => ({
        operationId: op.id,
        type: String(op.type || op.operationType || ""),
        status: String(op.status || ""),
        assignedBrokerId: String(op.assignedBrokerId || op.brokerId || op.ownerId || ""),
        createdAt: iso(op.createdAt),
        updatedAt: iso(op.updatedAt)
      }))
    };
  });

  const targetMatchReviewOperations = operations.filter((op) => {
    const type = String(op.type || op.operationType || "").toUpperCase();
    if (type !== "MATCH_REVIEW") return false;
    const ids = [
      op.clientRequestId,
      op.requestId,
      op.ownerOfferId,
      op.offerId,
      op.metadata?.clientRequestId,
      op.metadata?.requestId,
      op.metadata?.ownerOfferId,
      op.metadata?.offerId
    ].map((value) => String(value || ""));
    return ids.some((id) => targetOpportunityIds.has(id));
  }).map((op) => ({
    operationId: op.id,
    matchId: String(op.matchId || op.metadata?.matchId || ""),
    type: String(op.type || op.operationType || ""),
    status: String(op.status || ""),
    assignedBrokerId: String(op.assignedBrokerId || op.brokerId || op.ownerId || ""),
    requestId: String(op.clientRequestId || op.requestId || op.metadata?.clientRequestId || op.metadata?.requestId || ""),
    offerId: String(op.ownerOfferId || op.offerId || op.metadata?.ownerOfferId || op.metadata?.offerId || ""),
    createdAt: iso(op.createdAt),
    updatedAt: iso(op.updatedAt)
  }));

  return {
    officeId: officeRef.id,
    officePath: officeRef.path,
    counts: {
      opportunitiesLoaded: opportunities.length,
      matchesLoaded: matches.length,
      operationsLoaded: operations.length,
      matchReviewOperations: operations.filter((op) => String(op.type || op.operationType || "").toUpperCase() === "MATCH_REVIEW").length
    },
    linkedMatches,
    targetMatchReviewOperations
  };
}

async function main() {
  // Read-only global discovery: this proves which office document actually owns
  // the opportunity visible in Staging before any product code is changed.
  const allOpportunitiesSnap = await db.collectionGroup("opportunities").get();
  const allOpportunityDocs = allOpportunitiesSnap.docs;
  const targetDocs = allOpportunityDocs.filter((doc) => opportunityMatchesScreenshot(doc.data() || {}));
  const targetOpportunities = targetDocs.map(describeOpportunity);

  const officeCounts = new Map();
  for (const doc of allOpportunityDocs) {
    const officeRef = doc.ref.parent.parent;
    const officeId = officeRef?.id || "";
    if (!officeId) continue;
    officeCounts.set(officeId, (officeCounts.get(officeId) || 0) + 1);
  }

  const targetByOffice = new Map();
  for (const doc of targetDocs) {
    const officeRef = doc.ref.parent.parent;
    if (!officeRef) continue;
    const bucket = targetByOffice.get(officeRef.path) || { officeRef, ids: new Set() };
    bucket.ids.add(doc.id);
    targetByOffice.set(officeRef.path, bucket);
  }

  const inspectedOffices = [];
  for (const { officeRef, ids } of targetByOffice.values()) {
    inspectedOffices.push(await inspectOffice(officeRef, ids));
  }

  const expectedOfficeCount = officeCounts.get(EXPECTED_OFFICE_ID) || 0;
  const discoveredTargetOfficeIds = [...new Set(targetOpportunities.map((item) => item.officeId).filter(Boolean))];

  console.log("THAMER_MATCH_DAILY_TASK_DIAGNOSTIC");
  console.log(JSON.stringify({
    projectId: PROJECT_ID,
    expectedOfficeId: EXPECTED_OFFICE_ID,
    totalOpportunitiesAcrossStaging: allOpportunityDocs.length,
    expectedOfficeOpportunityCount: expectedOfficeCount,
    discoveredOfficeOpportunityCounts: Object.fromEntries([...officeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    screenshotOpportunityCandidates: targetOpportunities,
    discoveredTargetOfficeIds,
    officeIdMismatch: discoveredTargetOfficeIds.length > 0 && !discoveredTargetOfficeIds.includes(EXPECTED_OFFICE_ID),
    inspectedOffices
  }, null, 2));

  await app.delete();
}

main().catch(async (error) => {
  console.error("THAMER_DIAGNOSTIC_FAILED", error?.stack || error);
  try { await app.delete(); } catch (_) {}
  process.exit(1);
});
