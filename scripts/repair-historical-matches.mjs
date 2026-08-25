#!/usr/bin/env node
/**
 * Historical match repair for the live staging office.
 * Repairable: copy proven canonical opportunity IDs onto requestId/offerId.
 * Unrepairable: mark integrityStatus=INVALID. Does not invent pairings.
 *
 *   node scripts/repair-historical-matches.mjs           # dry-run
 *   node scripts/repair-historical-matches.mjs --apply   # write
 */
import { writeFileSync, mkdirSync } from "node:fs";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import { classifyHistoricalMatch } from "../worker/src/match-integrity-domain.js";
import {
  consumeDailyTaskDiagnostics,
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";

const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const OFFICE_ID = process.env.AUDIT_OFFICE_ID || "staging-logo-live-20260807";
const APPLY = process.argv.includes("--apply");
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
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

function parseMetadata(op = {}) {
  if (op.metadata && typeof op.metadata === "object") return { ...op.metadata };
  if (typeof op.metadataJson === "string" && op.metadataJson) {
    try {
      const parsedJson = JSON.parse(op.metadataJson);
      return parsedJson && typeof parsedJson === "object" ? parsedJson : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function inventory(office) {
  const [matchesSnap, oppsSnap, opsSnap] = await Promise.all([
    office.collection("matches").limit(200).get(),
    office.collection("opportunities").limit(400).get(),
    office.collection("operations").limit(200).get()
  ]);
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
      propertyType: item.propertyType || "",
      purpose: item.purpose || item.transactionType || item.kind || "",
      district: item.district || "",
      city: item.city || "",
      salePrice: item.salePrice ?? item.price,
      budget: item.budget ?? item.priceMax,
      area: item.area || 0,
      contactPhone: item.contactPhone || item.phone || "",
      contactName: item.contactName || "",
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
  return {
    matchesSnap,
    oppsSnap,
    opsSnap,
    mapped,
    hidden,
    docsById: Object.fromEntries(oppsSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]))
  };
}

async function main() {
  const office = db.collection("offices").doc(OFFICE_ID);
  const before = await inventory(office);
  const actions = [];

  for (const doc of before.matchesSnap.docs) {
    const data = doc.data() || {};
    const classified = classifyHistoricalMatch({ officeId: OFFICE_ID, ...data, id: doc.id }, before.docsById);
    if (classified.class === "REPAIRABLE") {
      actions.push({
        kind: "repair_match",
        matchId: doc.id,
        requestId: classified.requestId,
        offerId: classified.offerId,
        method: classified.method
      });
      if (APPLY) {
        await doc.ref.set({
          requestId: classified.requestId,
          offerId: classified.offerId,
          clientRequestId: classified.requestId,
          ownerOfferId: classified.offerId,
          integrityStatus: "VALID",
          integrityReason: "",
          integrityRepairMethod: classified.method,
          integrityRepairedAt: FieldValue.serverTimestamp(),
          officeId: OFFICE_ID,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } else {
      actions.push({
        kind: "invalidate_match",
        matchId: doc.id,
        reason: classified.integrityReason || "unrepairable_canonical_linkage"
      });
      if (APPLY) {
        await doc.ref.set({
          integrityStatus: "INVALID",
          integrityReason: classified.integrityReason || "unrepairable_canonical_linkage",
          integrityClass: "UNREPAIRABLE",
          officeId: OFFICE_ID,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
  }

  const repairedByMatchId = Object.fromEntries(
    actions.filter((row) => row.kind === "repair_match").map((row) => [row.matchId, row])
  );

  for (const doc of before.opsSnap.docs) {
    const data = doc.data() || {};
    if (String(data.type || "") !== "MATCH_REVIEW") continue;
    const matchId = String(data.matchId || data.sourceEntityId || "");
    const repaired = repairedByMatchId[matchId];
    const matchDoc = before.matchesSnap.docs.find((row) => row.id === matchId);
    const metadata = parseMetadata(data);
    if (repaired) {
      actions.push({ kind: "repair_operation", operationId: doc.id, matchId, requestId: repaired.requestId, offerId: repaired.offerId });
      if (APPLY) {
        const nextMeta = {
          ...metadata,
          clientRequestId: repaired.requestId,
          ownerOfferId: repaired.offerId,
          requestId: repaired.requestId,
          offerId: repaired.offerId,
          integrityStatus: "VALID",
          integrityReason: ""
        };
        await doc.ref.set({
          clientRequestId: repaired.requestId,
          ownerOfferId: repaired.offerId,
          requestId: repaired.requestId,
          offerId: repaired.offerId,
          integrityStatus: "VALID",
          integrityReason: "",
          metadataJson: JSON.stringify(nextMeta),
          officeId: OFFICE_ID,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      continue;
    }
    if (!matchDoc) {
      actions.push({ kind: "invalidate_operation", operationId: doc.id, matchId, reason: "match_document_missing" });
      if (APPLY) {
        const nextMeta = { ...metadata, integrityStatus: "INVALID", integrityReason: "match_document_missing" };
        await doc.ref.set({
          integrityStatus: "INVALID",
          integrityReason: "match_document_missing",
          metadataJson: JSON.stringify(nextMeta),
          officeId: OFFICE_ID,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
  }

  const after = APPLY ? await inventory(office) : before;
  const summary = {
    generatedAt: new Date().toISOString(),
    officeId: OFFICE_ID,
    applied: APPLY,
    before: {
      visibleSendable: before.mapped.length,
      invalidTaskData: before.hidden.length,
      matchIntegrityValid: before.matchesSnap.docs.filter((doc) => String(doc.data()?.integrityStatus || "") === "VALID").length,
      matchIntegrityInvalid: before.matchesSnap.docs.filter((doc) => String(doc.data()?.integrityStatus || "") === "INVALID").length
    },
    after: {
      visibleSendable: after.mapped.length,
      invalidTaskData: after.hidden.length,
      matchIntegrityValid: after.matchesSnap.docs.filter((doc) => String(doc.data()?.integrityStatus || "") === "VALID").length,
      matchIntegrityInvalid: after.matchesSnap.docs.filter((doc) => String(doc.data()?.integrityStatus || "") === "INVALID").length
    },
    repairableMatches: actions.filter((row) => row.kind === "repair_match").length,
    unrepairableMatches: actions.filter((row) => row.kind === "invalidate_match").length,
    repairedOperations: actions.filter((row) => row.kind === "repair_operation").length,
    invalidatedOperations: actions.filter((row) => row.kind === "invalidate_operation").length,
    actions
  };

  mkdirSync(OUT, { recursive: true });
  mkdirSync("/workspace/qa", { recursive: true });
  writeFileSync(`${OUT}/historical-match-repair.json`, JSON.stringify(summary, null, 2));
  writeFileSync("/workspace/qa/historical-match-repair.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    applied: APPLY,
    before: summary.before,
    after: summary.after,
    repairableMatches: summary.repairableMatches,
    unrepairableMatches: summary.unrepairableMatches
  }, null, 2));
  await app.delete();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
