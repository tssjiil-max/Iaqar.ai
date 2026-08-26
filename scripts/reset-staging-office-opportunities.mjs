#!/usr/bin/env node
/**
 * Staging opportunity-cycle reset for ONE office.
 * Default is DRY RUN. Never deletes office profile, members, branding, or settings.
 *
 *   node scripts/reset-staging-office-opportunities.mjs
 *   node scripts/reset-staging-office-opportunities.mjs --apply --confirm=RESET_STAGING_OPPORTUNITIES
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import {
  completedDealSafety,
  countOpportunitySides,
  DELETE_COLLECTIONS,
  officeIdentityMatches,
  PRESERVED_COLLECTIONS,
  RESET_TARGET_OFFICE_ID
} from "../public/js/staging-opportunity-reset-domain.js";

const PROJECT_ID = "iaqar-ai-staging";
const APPLY = process.argv.includes("--apply");
const CONFIRM = (process.argv.find((arg) => arg.startsWith("--confirm=")) || "").slice(10);
const OFFICE_ARG = (process.argv.find((arg) => arg.startsWith("--office=")) || "").slice(9);
const OUT_DIR = path.resolve("qa");

if (OFFICE_ARG && OFFICE_ARG !== RESET_TARGET_OFFICE_ID) {
  console.error("STOP: officeId does not match the current staging office", OFFICE_ARG);
  process.exit(2);
}
if (APPLY && CONFIRM !== "RESET_STAGING_OPPORTUNITIES") {
  console.error("STOP: --apply requires --confirm=RESET_STAGING_OPPORTUNITIES");
  process.exit(2);
}

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}

const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const officeId = RESET_TARGET_OFFICE_ID;
const office = db.collection("offices").doc(officeId);

async function listAll(colRef) {
  const out = [];
  let last = null;
  while (true) {
    const query = last ? colRef.startAfter(last).limit(400) : colRef.limit(400);
    const snap = await query.get();
    if (!snap.docs.length) break;
    for (const doc of snap.docs) out.push({ id: doc.id, ref: doc.ref, ...doc.data() });
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 400) break;
  }
  return out;
}

async function deleteRecursive(docRef) {
  const subs = await docRef.listCollections();
  for (const col of subs) {
    const snap = await col.limit(400).get();
    for (const doc of snap.docs) await deleteRecursive(doc.ref);
  }
  await docRef.delete();
}

function stripRef(row) {
  const { ref, ...rest } = row;
  return rest;
}

const officeSnap = await office.get();
if (!officeSnap.exists) {
  console.error("STOP: office document missing");
  process.exit(2);
}
const officeData = officeSnap.data() || {};
if (!officeIdentityMatches({ officeId, exists: true })) {
  console.error("STOP: officeId does not match the current staging office");
  process.exit(2);
}

const collections = (await office.listCollections()).map((col) => col.id);
const inventory = {};
for (const name of [...new Set([...DELETE_COLLECTIONS, ...PRESERVED_COLLECTIONS, ...collections])]) {
  inventory[name] = await listAll(office.collection(name)).catch(() => []);
}

const [coopOrigin, coopTarget] = await Promise.all([
  db.collection("cooperationRequests").where("originatingOfficeId", "==", officeId).limit(200).get(),
  db.collection("cooperationRequests").where("targetOfficeId", "==", officeId).limit(200).get()
]);
const coopMap = new Map();
for (const doc of [...coopOrigin.docs, ...coopTarget.docs]) {
  coopMap.set(doc.id, { id: doc.id, ref: doc.ref, ...doc.data() });
}
const cooperations = [...coopMap.values()];

const matchTimelines = [];
for (const match of inventory.matches || []) {
  const timeline = await listAll(office.collection("matches").doc(match.id).collection("timeline"));
  if (timeline.length) matchTimelines.push({ matchId: match.id, count: timeline.length, ids: timeline.map((row) => row.id) });
}

const opportunities = inventory.opportunities || [];
const sides = countOpportunitySides(opportunities);
const dealScan = completedDealSafety([
  ...(inventory.deals || []),
  ...(inventory.operations || []),
  ...opportunities,
  ...(inventory.matches || [])
]);

const toDelete = {
  opportunities: (inventory.opportunities || []).map((row) => row.id),
  matches: (inventory.matches || []).map((row) => row.id),
  operations: (inventory.operations || []).map((row) => row.id),
  partySessions: (inventory.partySessions || []).map((row) => row.id),
  partyLinks: (inventory.partyLinks || []).map((row) => row.id),
  partySessionKeys: (inventory.partySessionKeys || []).map((row) => row.id),
  clients: (inventory.clients || []).map((row) => row.id),
  owners: (inventory.owners || []).map((row) => row.id),
  alerts: (inventory.alerts || []).map((row) => row.id),
  notifications: (inventory.notifications || []).map((row) => row.id),
  opportunitySources: (inventory.opportunitySources || []).map((row) => row.id),
  importJobs: (inventory.importJobs || []).map((row) => row.id),
  messages: (inventory.messages || []).map((row) => row.id),
  matchDiagnostics: (inventory.matchDiagnostics || []).map((row) => row.id),
  deals: (inventory.deals || []).map((row) => row.id),
  appointments: (inventory.appointments || []).map((row) => row.id),
  cooperationsLocal: (inventory.cooperations || []).map((row) => row.id),
  cooperationRequests: cooperations.map((row) => row.id),
  matchTimelines
};

const before = {
  opportunities: opportunities.length,
  offers: sides.offers,
  requests: sides.requests,
  otherOpportunityKinds: sides.other,
  matches: (inventory.matches || []).length,
  operations: (inventory.operations || []).length,
  partySessions: (inventory.partySessions || []).length,
  cooperations: cooperations.length + (inventory.cooperations || []).length,
  appointments: (inventory.appointments || []).length,
  timelineWorkflow: matchTimelines.reduce((sum, row) => sum + row.count, 0)
    + (inventory.messages || []).length
    + (inventory.alerts || []).length
};

const preserved = {
  officeExists: true,
  officeName: officeData.officeName || "",
  displayName: officeData.displayName || "",
  brokerName: officeData.brokerName || "",
  licenseNumber: officeData.licenseNumber || "",
  city: officeData.city || "",
  logoUrl: Boolean(officeData.logoUrl),
  coverUrl: Boolean(officeData.coverUrl),
  displayImageUrl: Boolean(officeData.displayImageUrl),
  members: (inventory.members || []).length,
  settingsDocs: (inventory.officeSettings || []).map((row) => row.id),
  devices: (inventory.devices || []).length,
  library: (inventory.library || []).length,
  activityEvents: (inventory.activityEvents || []).length,
  contacts: (inventory.contacts || []).length
};

const dryRun = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "APPLY" : "DRY_RUN",
  officeId,
  note: "Stored officeName is Staging Logo Live. مكتب الوادي المبارك is a different office (staging-sultan) and is not in scope.",
  before,
  preserved,
  completedDealSafety: {
    ok: dealScan.ok,
    completedCount: dealScan.completedCount,
    blocked: dealScan.blocked.map((row) => ({ id: row.id, type: row.operationType || row.type, status: row.status }))
  },
  willDelete: Object.fromEntries(Object.entries(toDelete).map(([key, value]) => [
    key,
    Array.isArray(value) && value[0] && value[0].matchId ? value : { count: value.length, ids: value }
  ])),
  willNotDelete: PRESERVED_COLLECTIONS
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "staging-opportunity-reset-dry-run.json"), `${JSON.stringify(dryRun, null, 2)}\n`);
console.log(JSON.stringify({
  mode: dryRun.mode,
  officeId,
  officeName: preserved.officeName,
  before,
  completedDealSafety: dryRun.completedDealSafety,
  deleteCounts: Object.fromEntries(Object.entries(toDelete).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.length : 0
  ])),
  preserved: {
    members: preserved.members,
    logoUrl: preserved.logoUrl,
    coverUrl: preserved.coverUrl,
    settingsDocs: preserved.settingsDocs
  }
}, null, 2));

if (!dealScan.ok) {
  console.error("STOP: DEAL_COMPLETED records are not clearly experimental");
  await app.delete();
  process.exit(3);
}

if (!APPLY) {
  await app.delete();
  process.exit(0);
}

const deleted = {};
for (const name of DELETE_COLLECTIONS) {
  const rows = inventory[name] || [];
  for (const row of rows) await deleteRecursive(row.ref);
  deleted[name] = rows.length;
}
for (const row of cooperations) {
  await deleteRecursive(row.ref);
}
deleted.cooperationRequests = cooperations.length;

async function recount(name) {
  return (await office.collection(name).limit(20).get()).size;
}

const after = {
  opportunities: await recount("opportunities"),
  matches: await recount("matches"),
  operations: await recount("operations"),
  partySessions: await recount("partySessions"),
  clients: await recount("clients"),
  owners: await recount("owners"),
  alerts: await recount("alerts"),
  notifications: await recount("notifications"),
  messages: await recount("messages"),
  officeExists: (await office.get()).exists,
  members: await recount("members"),
  officeSettings: await recount("officeSettings"),
  logoUrl: Boolean((await office.get()).data()?.logoUrl),
  coverUrl: Boolean((await office.get()).data()?.coverUrl),
  displayImageUrl: Boolean((await office.get()).data()?.displayImageUrl),
  officeName: (await office.get()).data()?.officeName || ""
};

const applyReport = { ...dryRun, mode: "APPLY", deleted, after };
writeFileSync(path.join(OUT_DIR, "staging-opportunity-reset-apply.json"), `${JSON.stringify({
  ...applyReport,
  willDelete: dryRun.willDelete
}, null, 2)}\n`);
console.log(JSON.stringify({ after, deleted }, null, 2));
await app.delete();
