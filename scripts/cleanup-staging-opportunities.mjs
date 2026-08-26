#!/usr/bin/env node
/**
 * Staging opportunity cleanup. Default is DRY RUN.
 * Never deletes office profile, members, settings, branding, or unproven records.
 *
 *   node scripts/cleanup-staging-opportunities.mjs
 *   node scripts/cleanup-staging-opportunities.mjs --office=staging-logo-live-20260807
 *   node scripts/cleanup-staging-opportunities.mjs --apply --office=staging-logo-live-20260807 --confirm=DELETE_STAGING_QA
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import {
  CLEANUP_DECISION,
  canAutoDeleteDecision,
  classifyCleanupRecord,
  isStagingOfficeId,
  protectedCollections
} from "../public/js/opportunity-cleanup-domain.js";
import { buildOpportunityDeletePlan } from "../public/js/opportunity-delete-plan-domain.js";

const PROJECT_ID = "iaqar-ai-staging";
const DEFAULT_OFFICE = "staging-logo-live-20260807";
const APPLY = process.argv.includes("--apply");
const CONFIRM = (process.argv.find((arg) => arg.startsWith("--confirm=")) || "").slice(10);
const OFFICE_ARG = (process.argv.find((arg) => arg.startsWith("--office=")) || "").slice(9);
const ALLOWLIST_FILE = (process.argv.find((arg) => arg.startsWith("--allowlist=")) || "").slice(12);
const OUT_DIR = path.resolve("qa");

function argOffice() {
  return String(OFFICE_ARG || "").trim();
}

function loadJson(file, fallback) {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function integrityLegacyIds() {
  const repair = loadJson("qa/historical-match-repair.json", {});
  const dump = loadJson("qa/broken-match-dump.json", {});
  const ids = [];
  for (const action of repair.actions || []) {
    if (action.kind === "invalidate_match" || action.kind === "invalidate_operation") {
      if (action.matchId) ids.push(action.matchId);
      if (action.operationId) ids.push(action.operationId);
    }
  }
  for (const row of dump.hidden || []) {
    if (row.matchId && (row.reasons || []).includes("unresolved_request")) ids.push(row.matchId);
  }
  return [...new Set(ids.filter(Boolean))];
}

function allowlistIds() {
  const fromFile = loadJson(ALLOWLIST_FILE, []);
  const list = Array.isArray(fromFile) ? fromFile : (fromFile.ids || []);
  return [...new Set(list.map(String))];
}

function toData(doc) {
  return { id: doc.id, ...(doc.data() || {}) };
}

async function listCollection(office, name, limit = 500) {
  const snap = await office.collection(name).limit(limit).get();
  return snap.docs.map(toData);
}

async function listGlobalCooperations(db, officeId) {
  const [origin, target] = await Promise.all([
    db.collection("cooperationRequests").where("originatingOfficeId", "==", officeId).limit(100).get().catch(() => ({ docs: [] })),
    db.collection("cooperationRequests").where("targetOfficeId", "==", officeId).limit(100).get().catch(() => ({ docs: [] }))
  ]);
  const map = new Map();
  for (const doc of [...origin.docs, ...target.docs]) map.set(doc.id, toData(doc));
  return [...map.values()];
}

function classifyMany(rows, extra) {
  return rows.map((row) => ({ ...classifyCleanupRecord(row, extra), type: extra.type, record: row }));
}

async function main() {
  const officeId = argOffice() || (APPLY ? "" : DEFAULT_OFFICE);
  if (APPLY && !officeId) {
    console.error("STOP: --office is required for --apply");
    process.exit(2);
  }
  if (!isStagingOfficeId(officeId)) {
    console.error("STOP: office is not a staging/QA office:", officeId);
    process.exit(2);
  }
  if (APPLY && CONFIRM !== "DELETE_STAGING_QA") {
    console.error("STOP: --apply requires --confirm=DELETE_STAGING_QA");
    process.exit(2);
  }

  const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
  if (!parsed.serviceAccount) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
    process.exit(1);
  }
  const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
  const db = getFirestore(app);
  const office = db.collection("offices").doc(officeId);
  const officeSnap = await office.get();
  if (!officeSnap.exists) {
    console.error("STOP: office document missing");
    process.exit(2);
  }

  const extra = {
    allowlistIds: allowlistIds(),
    integrityLegacyIds: integrityLegacyIds()
  };

  const [
    opportunities,
    matches,
    operations,
    partySessions,
    notifications,
    deals,
    clients,
    owners,
    alerts,
    matchDiagnostics,
    cooperations
  ] = await Promise.all([
    listCollection(office, "opportunities"),
    listCollection(office, "matches"),
    listCollection(office, "operations"),
    listCollection(office, "partySessions"),
    listCollection(office, "notifications"),
    listCollection(office, "deals"),
    listCollection(office, "clients"),
    listCollection(office, "owners"),
    listCollection(office, "alerts"),
    listCollection(office, "matchDiagnostics"),
    listGlobalCooperations(db, officeId)
  ]);

  const classified = {
    opportunities: classifyMany(opportunities, { ...extra, type: "opportunity" }),
    matches: classifyMany(matches, { ...extra, type: "match" }),
    operations: classifyMany(operations, { ...extra, type: "operation" }),
    partySessions: classifyMany(partySessions, { ...extra, type: "partySession" }),
    notifications: classifyMany(notifications, { ...extra, type: "notification" }),
    deals: classifyMany(deals, { ...extra, type: "deal" }),
    clients: classifyMany(clients, { ...extra, type: "client" }),
    owners: classifyMany(owners, { ...extra, type: "owner" }),
    alerts: classifyMany(alerts, { ...extra, type: "alert" }),
    matchDiagnostics: classifyMany(matchDiagnostics, { ...extra, type: "matchDiagnostic" }),
    cooperations: classifyMany(cooperations, { ...extra, type: "cooperation" })
  };

  const classifiedRows = Object.values(classified).flat();
  const directDeletes = classifiedRows
    .filter((row) => canAutoDeleteDecision(row.decision))
    .map((row) => ({ type: row.type, action: "delete", id: row.id, reason: row.reason }));

  const deletingOppIds = classified.opportunities
    .filter((row) => canAutoDeleteDecision(row.decision))
    .map((row) => row.id);

  const exclusivePlan = buildOpportunityDeletePlan({
    opportunityIds: deletingOppIds,
    matches,
    operations,
    partySessions,
    cooperations,
    appointments: deals,
    notifications
  });

  const deleteMap = new Map();
  for (const row of [...directDeletes, ...exclusivePlan.delete]) {
    deleteMap.set(`${row.type}:${row.id}`, row);
  }
  const plan = {
    delete: [...deleteMap.values()],
    skip: exclusivePlan.skip.filter((row) => !deleteMap.has(`${row.type}:${row.id}`)),
    counts: {}
  };
  for (const row of plan.delete) {
    plan.counts[row.type] = Number(plan.counts[row.type] || 0) + 1;
  }

  const candidates = Object.values(classified).flat()
    .filter((row) => row.decision === CLEANUP_DECISION.CANDIDATE || row.decision === CLEANUP_DECISION.REVIEW_REQUIRED)
    .map((row) => ({
      id: row.id,
      type: row.type,
      officeId,
      reason: row.reason,
      decision: row.decision,
      linkedMatchIds: matches.filter((item) => JSON.stringify(item).includes(row.id)).map((item) => item.id).slice(0, 8),
      linkedTaskIds: operations.filter((item) => JSON.stringify(item).includes(row.id)).map((item) => item.id).slice(0, 8),
      linkedPartySessions: partySessions.filter((item) => JSON.stringify(item).includes(row.id)).map((item) => item.id).slice(0, 8),
      linkedAppointments: deals.filter((item) => JSON.stringify(item).includes(row.id)).map((item) => item.id).slice(0, 8)
    }));

  const counts = Object.fromEntries(Object.entries(classified).map(([key, rows]) => [key, {
    total: rows.length,
    autoDelete: rows.filter((row) => row.decision === CLEANUP_DECISION.AUTO_DELETE).length,
    allowlist: rows.filter((row) => row.decision === CLEANUP_DECISION.ALLOWLIST).length,
    candidate: rows.filter((row) => row.decision === CLEANUP_DECISION.CANDIDATE).length,
    reviewRequired: rows.filter((row) => row.decision === CLEANUP_DECISION.REVIEW_REQUIRED).length
  }]));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    officeId,
    projectId: PROJECT_ID,
    officeExists: true,
    preserved: protectedCollections(),
    counts,
    plan: {
      delete: plan.delete,
      skip: plan.skip,
      counts: plan.counts
    },
    willPreserve: {
      officeProfile: true,
      users: true,
      settings: true,
      branding: true,
      configuration: true
    }
  };

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  writeFileSync(path.join(OUT_DIR, "opportunity-cleanup-dry-run.json"), JSON.stringify(report, null, 2));
  writeFileSync("/opt/cursor/artifacts/opportunity-cleanup-dry-run.json", JSON.stringify(report, null, 2));
  writeFileSync(path.join(OUT_DIR, "opportunity-cleanup-candidates.json"), JSON.stringify(candidates, null, 2));
  if (!ALLOWLIST_FILE) {
    const recommendedAllowlist = {
      officeId,
      reason: "Inspected suspect QA ids (e2e/dbg/api) plus integrity-invalid matches. REVIEW_REQUIRED rows are excluded.",
      ids: candidates.filter((row) => row.decision === CLEANUP_DECISION.CANDIDATE).map((row) => row.id)
    };
    writeFileSync(path.join(OUT_DIR, "opportunity-cleanup-allowlist.json"), JSON.stringify(recommendedAllowlist, null, 2));
  }

  console.log(`Office:\n${officeId}\n`);
  console.log("Candidates (in-scope tagged/allowlist + plan):");
  console.log(`Opportunities: ${plan.counts.opportunity || 0}`);
  console.log(`Matches: ${plan.counts.match || 0}`);
  console.log(`Tasks: ${plan.counts.operation || 0}`);
  console.log(`Party sessions: ${plan.counts.partySession || 0}`);
  console.log(`Cooperations: ${plan.counts.cooperation || 0}`);
  console.log(`Appointments: ${plan.counts.appointment || 0}`);
  console.log("\nWill preserve:\nOffice profile\nUsers\nSettings\nBranding\nConfiguration");
  console.log(`\nREVIEW_REQUIRED / untagged candidates: ${candidates.length} (see qa/opportunity-cleanup-candidates.json)`);
  console.log(`Mode: ${report.mode}`);

  if (!APPLY) {
    await app.delete();
    return;
  }

  const deleted = [];
  for (const row of plan.delete) {
    let ref = null;
    if (row.type === "opportunity") ref = office.collection("opportunities").doc(row.id);
    else if (row.type === "match") ref = office.collection("matches").doc(row.id);
    else if (row.type === "operation") ref = office.collection("operations").doc(row.id);
    else if (row.type === "partySession") ref = office.collection("partySessions").doc(row.id);
    else if (row.type === "notification") ref = office.collection("notifications").doc(row.id);
    else if (row.type === "appointment" || row.type === "deal") ref = office.collection("deals").doc(row.id);
    else if (row.type === "cooperation") ref = db.collection("cooperationRequests").doc(row.id);
    if (!ref) continue;
    await ref.delete();
    deleted.push(row);
  }

  for (const group of ["clients", "owners", "alerts", "matchDiagnostics"]) {
    for (const row of classified[group]) {
      if (!canAutoDeleteDecision(row.decision)) continue;
      await office.collection(group).doc(row.id).delete();
      deleted.push({ type: group, id: row.id, action: "delete", reason: row.reason });
    }
  }

  const afterOffice = await office.get();
  const result = {
    ...report,
    applied: true,
    deletedCount: deleted.length,
    deleted,
    officeSurvived: afterOffice.exists,
    officeName: afterOffice.data()?.officeName || ""
  };
  writeFileSync(path.join(OUT_DIR, "opportunity-cleanup-apply.json"), JSON.stringify(result, null, 2));
  writeFileSync("/opt/cursor/artifacts/opportunity-cleanup-apply.json", JSON.stringify(result, null, 2));
  console.log(`Deleted ${deleted.length} records. Office survived: ${afterOffice.exists}`);
  if (!afterOffice.exists) {
    console.error("CRITICAL FAIL: office document missing after cleanup");
    process.exit(3);
  }
  await app.delete();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
