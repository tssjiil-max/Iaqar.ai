#!/usr/bin/env node
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT_ID = "iaqar-ai-staging";
const OFFICE_ID = "thamer";
const TARGET_PHONE = "0552019909";

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
const office = db.collection("offices").doc(OFFICE_ID);

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

function ids(data = {}) {
  return {
    requestId: String(data.clientRequestId || data.requestId || ""),
    offerId: String(data.ownerOfferId || data.offerId || "")
  };
}

async function main() {
  const [matchesSnap, operationsSnap, opportunitiesSnap] = await Promise.all([
    office.collection("matches").orderBy("createdAt", "desc").limit(40).get(),
    office.collection("operations").limit(500).get(),
    office.collection("opportunities").limit(500).get()
  ]);

  const operations = operationsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const opportunities = opportunitiesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const matches = matchesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

  const targetOpps = opportunities.filter((opp) => {
    const phones = [opp.contactPhone, opp.phone, opp.advertiserPhoneNormalized, opp.contactPhoneNormalized];
    const phoneHit = phones.some((p) => digits(p).endsWith(digits(TARGET_PHONE)));
    const budgetHit = Number(opp.budget ?? opp.priceMax ?? opp.priceOrBudget ?? NaN) === 123;
    return phoneHit || budgetHit;
  });
  const targetIds = new Set(targetOpps.map((opp) => opp.id));

  const rows = matches.slice(0, 20).map((match) => {
    const pair = ids(match);
    const linkedOps = operations.filter((op) => String(op.matchId || "") === match.id);
    return {
      matchId: match.id,
      createdAt: iso(match.createdAt),
      updatedAt: iso(match.updatedAt),
      status: String(match.status || ""),
      integrityStatus: String(match.integrityStatus || ""),
      requestId: pair.requestId,
      offerId: pair.offerId,
      requestExists: pair.requestId ? opportunities.some((opp) => opp.id === pair.requestId) : false,
      offerExists: pair.offerId ? opportunities.some((opp) => opp.id === pair.offerId) : false,
      operationIdOnMatch: String(match.operationId || ""),
      matchReviewOperations: linkedOps.filter((op) => String(op.type || op.operationType || "").toUpperCase() === "MATCH_REVIEW").map((op) => ({
        operationId: op.id,
        status: String(op.status || ""),
        requestId: String(op.clientRequestId || op.requestId || op.metadata?.clientRequestId || ""),
        offerId: String(op.ownerOfferId || op.offerId || op.metadata?.ownerOfferId || ""),
        createdAt: iso(op.createdAt),
        updatedAt: iso(op.updatedAt)
      })),
      touchesScreenshotOpportunity: targetIds.has(pair.requestId) || targetIds.has(pair.offerId)
    };
  });

  const orphanMatchReviews = operations
    .filter((op) => String(op.type || op.operationType || "").toUpperCase() === "MATCH_REVIEW")
    .filter((op) => !matches.some((match) => match.id === String(op.matchId || "")))
    .slice(0, 20)
    .map((op) => ({ operationId: op.id, matchId: String(op.matchId || ""), status: String(op.status || "") }));

  console.log("THAMER_MATCH_DAILY_TASK_DIAGNOSTIC");
  console.log(JSON.stringify({
    officeId: OFFICE_ID,
    counts: {
      matchesLoaded: matches.length,
      operationsLoaded: operations.length,
      matchReviewOperations: operations.filter((op) => String(op.type || op.operationType || "").toUpperCase() === "MATCH_REVIEW").length,
      opportunitiesLoaded: opportunities.length
    },
    screenshotOpportunityCandidates: targetOpps.map((opp) => ({
      id: opp.id,
      kind: String(opp.opportunityKind || opp.kind || ""),
      lifecycleStatus: String(opp.lifecycleStatus || opp.status || ""),
      matchingReadiness: String(opp.matchingReadiness || ""),
      createdAt: iso(opp.createdAt),
      updatedAt: iso(opp.updatedAt)
    })),
    latestMatches: rows,
    orphanMatchReviews
  }, null, 2));

  await app.delete();
}

main().catch(async (error) => {
  console.error("THAMER_DIAGNOSTIC_FAILED", error?.stack || error);
  try { await app.delete(); } catch (_) {}
  process.exit(1);
});
