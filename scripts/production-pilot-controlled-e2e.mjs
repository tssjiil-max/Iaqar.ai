#!/usr/bin/env node
/**
 * Controlled production pilot live verification.
 * Creates only isTestFixture=true records tagged with testRunId.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import worker from "../worker/src/index.js";
import {
  consumeDailyTaskDiagnostics,
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";
import { PRODUCTION_HOST, PRODUCTION_PROJECT, PRODUCTION_WORKER } from "./production-credentials.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = process.env.PRODUCTION_PILOT_OUT || "/opt/cursor/artifacts";
const RUN_ID = process.env.PRODUCTION_PILOT_RUN_ID || `production-pilot-${Date.now().toString(36)}`;
const AUTHORIZED_OFFICE = "office_NlkMiaEugGVzDCc8d8jKNcrAFbI2";
const UNAUTHORIZED_OFFICE = "office_vWk9ToQENLRHOwJ0CejtuU3ut2K3";
const RC_SHA = process.env.PRODUCTION_RC_SHA || "";

const rawJson = process.env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON || "";
if (!rawJson) {
  console.error("FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON required");
  process.exit(1);
}
const serviceAccount = JSON.parse(rawJson);
initializeApp({ credential: cert(serviceAccount), projectId: PRODUCTION_PROJECT });
const db = getFirestore();
const auth = getAuth();
const office = db.collection("offices").doc(AUTHORIZED_OFFICE);

const workerEnv = {
  FIREBASE_PROJECT_ID: PRODUCTION_PROJECT,
  FIREBASE_CLIENT_EMAIL: serviceAccount.client_email,
  FIREBASE_PRIVATE_KEY: serviceAccount.private_key,
  FIREBASE_PRIVATE_KEY_ID: serviceAccount.private_key_id,
  DEPLOYMENT_ENV: "production"
};

const REQUEST_ID = `opp_${RUN_ID}_req`;
const OFFER_ID = `opp_${RUN_ID}_offer`;
const SALE_OFFER_ID = `opp_${RUN_ID}_sale`;
const RENT_REQUEST_ID = `opp_${RUN_ID}_rent`;

const report = {
  runId: RUN_ID,
  generatedAt: new Date().toISOString(),
  productionUrl: PRODUCTION_HOST,
  rcSha: RC_SHA,
  results: {}
};

function stamp(overrides = {}) {
  return {
    officeId: AUTHORIZED_OFFICE,
    lifecycleStatus: "ACTIVE",
    status: "active",
    matchingReadiness: "READY_FOR_MATCHING",
    dataCompleteness: 100,
    completeness: 100,
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    area: 120,
    rooms: 3,
    version: 1,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...overrides
  };
}

async function getOwnerToken() {
  const officeSnap = await office.get();
  const ownerUid = officeSnap.data()?.ownerUid;
  if (!ownerUid) throw new Error("authorized office ownerUid missing");
  const customToken = await auth.createCustomToken(ownerUid, { officeId: AUTHORIZED_OFFICE });
  const initRes = await fetch(`${PRODUCTION_HOST}/__/firebase/init.json`, { cache: "no-store" });
  const { apiKey } = await initRes.json();
  const signRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const signBody = await signRes.json();
  if (!signRes.ok || !signBody.idToken) throw new Error(`custom token sign-in failed ${signRes.status}`);
  return { idToken: signBody.idToken, customToken, apiKey };
}

async function workerFetch(pathname, { method = "GET", token, body } = {}) {
  const response = await worker.fetch(new Request(`https://iaqar.test${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), workerEnv);
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

async function verifyVersionMarker() {
  const res = await fetch(`${PRODUCTION_HOST}/version.json`, { cache: "no-store" });
  if (!res.ok) return { ok: false, reason: `version.json HTTP ${res.status}` };
  const payload = await res.json();
  const match = RC_SHA ? payload.fullSha === RC_SHA.toLowerCase() : Boolean(payload.fullSha);
  return { ok: match, payload };
}

async function verifyRuntimeRouting() {
  const runtime = await fetch(`${PRODUCTION_HOST}/js/runtime-config.js`, { cache: "no-store" }).then((r) => r.text());
  const checks = {
    productionWorker: runtime.includes("iaqar-macrodroid-intake"),
    notStagingWorker: !runtime.includes("iaqar-intake-staging"),
    productionProject: runtime.includes("aqar-b5d76")
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

async function cleanupFixtures() {
  for (const name of ["opportunities", "matches", "operations"]) {
    const snap = await office.collection(name).where("testRunId", "==", RUN_ID).limit(100).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
}

async function persistValidPair() {
  await office.collection("opportunities").doc(REQUEST_ID).set({
    ...stamp(),
    opportunityKind: "REQUEST",
    kind: "client_request",
    purpose: "LEASE_REQUEST",
    advertiserRole: "CLIENT",
    budget: 55000,
    priceMax: 55000,
    contactPhone: "0501111999",
    contactName: `E2E Request ${RUN_ID}`
  });
  await office.collection("opportunities").doc(OFFER_ID).set({
    ...stamp(),
    opportunityKind: "OFFER",
    kind: "owner_offer",
    purpose: "RENT",
    advertiserRole: "OWNER",
    annualRent: 50000,
    salePrice: 50000,
    contactPhone: "0502221999",
    contactName: `E2E Offer ${RUN_ID}`
  });
}

async function persistInvalidPair() {
  await office.collection("opportunities").doc(SALE_OFFER_ID).set({
    ...stamp(),
    opportunityKind: "OFFER",
    kind: "owner_offer",
    purpose: "SALE",
    advertiserRole: "OWNER",
    salePrice: 500000,
    contactPhone: "0503331999",
    contactName: `E2E Sale ${RUN_ID}`
  });
  await office.collection("opportunities").doc(RENT_REQUEST_ID).set({
    ...stamp(),
    opportunityKind: "REQUEST",
    kind: "client_request",
    purpose: "LEASE_REQUEST",
    advertiserRole: "CLIENT",
    budget: 50000,
    priceMax: 50000,
    contactPhone: "0504441999",
    contactName: `E2E Rent ${RUN_ID}`
  });
}

async function runMatching(token, opportunityId) {
  return workerFetch("/matching/run", {
    method: "POST",
    token,
    body: { officeId: AUTHORIZED_OFFICE, opportunityId, notify: false }
  });
}

function mapTasks(matchDocs) {
  const items = matchDocs.map((doc) => {
    const item = doc.data();
    return {
      id: doc.id,
      recordId: doc.id,
      recordType: "match",
      matchId: doc.id,
      requestId: item.requestId || item.clientRequestId || "",
      offerId: item.offerId || item.ownerOfferId || "",
      propertyType: item.propertyType || "",
      purpose: item.purpose || "",
      district: item.district || "",
      city: item.city || "",
      isTestFixture: true,
      testRunId: RUN_ID,
      createdBy: "E2E"
    };
  });
  consumeDailyTaskDiagnostics();
  const mapped = mapOperationsItemsToDailyTasks(items, new Date(), { officeId: AUTHORIZED_OFFICE });
  const hidden = consumeDailyTaskDiagnostics();
  return { mapped, hidden };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await cleanupFixtures();

  report.results.versionMarker = await verifyVersionMarker();
  report.results.runtimeRouting = await verifyRuntimeRouting();
  report.results.health = await fetch(`${PRODUCTION_WORKER}/health`).then((r) => r.json()).catch(() => ({}));

  const tokenBundle = await getOwnerToken();
  const pilotStatusAuth = await workerFetch(`/platform/pilot-status?officeId=${encodeURIComponent(AUTHORIZED_OFFICE)}`, { token: tokenBundle.idToken });
  const pilotStatusDenied = await workerFetch(`/platform/pilot-status?officeId=${encodeURIComponent(UNAUTHORIZED_OFFICE)}`, { token: tokenBundle.idToken });

  await persistValidPair();
  const reqSnap = await office.collection("opportunities").doc(REQUEST_ID).get();
  const offerSnap = await office.collection("opportunities").doc(OFFER_ID).get();
  report.results.canonicalSave = {
    ok: reqSnap.exists && offerSnap.exists,
    requestId: REQUEST_ID,
    offerId: OFFER_ID
  };

  const validMatch = await runMatching(tokenBundle.idToken, REQUEST_ID);
  const created = validMatch.body?.matches || [];
  const qaMatch = created.find((row) => row.requestId === REQUEST_ID && row.offerId === OFFER_ID) || created[0] || {};
  const matchId = qaMatch.matchId || "";
  const matchSnap = matchId ? await office.collection("matches").doc(matchId).get() : null;
  const reloadMatchSnap = matchId ? await office.collection("matches").doc(matchId).get() : null;

  await persistInvalidPair();
  const invalidMatch = await runMatching(tokenBundle.idToken, RENT_REQUEST_ID);
  const invalidPairs = (invalidMatch.body?.matches || []).filter((row) =>
    (row.requestId === RENT_REQUEST_ID && row.offerId === SALE_OFFER_ID)
    || (row.offerId === SALE_OFFER_ID && row.requestId === RENT_REQUEST_ID)
  );

  const matchDocs = matchId ? [await office.collection("matches").doc(matchId).get()] : [];
  const firstTasks = mapTasks(matchDocs.filter((doc) => doc.exists));
  const reloadTasks = mapTasks(matchDocs.filter((doc) => doc.exists));
  const task = firstTasks.mapped[0];
  const reloadTask = reloadTasks.mapped[0];

  const otherOfficeSnap = await db.collection("offices").doc(UNAUTHORIZED_OFFICE).collection("opportunities").limit(1).get();
  const isolationProbe = await workerFetch(`/offices/${AUTHORIZED_OFFICE}/opportunities/${REQUEST_ID}`, { token: tokenBundle.idToken });

  report.results.pilotAccess = {
    authorized: pilotStatusAuth.body?.officeAccess,
    unauthorized: pilotStatusDenied.body?.officeAccess,
    registration: pilotStatusAuth.body?.registration
  };
  report.results.validMatch = {
    status: validMatch.status,
    matchId,
    requestId: qaMatch.requestId,
    offerId: qaMatch.offerId,
    integrityStatus: qaMatch.integrityStatus,
    persisted: Boolean(matchSnap?.exists),
    reloaded: Boolean(reloadMatchSnap?.exists)
  };
  report.results.saleVsRent = {
    invalidPairCount: invalidPairs.length,
    ok: invalidPairs.length === 0
  };
  report.results.livingTask = {
    taskId: task?.id || "",
    reloadSameTaskId: Boolean(task && reloadTask && task.id === reloadTask.id),
    duplicateCount: firstTasks.mapped.filter((row) => row.matchId === matchId).length
  };
  report.results.officeIsolation = {
    unauthorizedOfficeReadableFromAuth: otherOfficeSnap.size > 0,
    authorizedOpportunityReadable: isolationProbe.status === 200
  };
  report.results.monitoring = {
    workerHealth: report.results.health?.backendReady === true,
    pilotEnabled: pilotStatusAuth.body?.enabled === true
  };

  writeFileSync(path.join(OUT, "production-pilot-controlled-e2e.json"), JSON.stringify(report, null, 2));

  const failures = [];
  if (!report.results.versionMarker.ok) failures.push("version");
  if (!report.results.canonicalSave.ok) failures.push("canonical_save");
  if (!report.results.validMatch.matchId || report.results.validMatch.integrityStatus !== "VALID") failures.push("valid_match");
  if (!report.results.saleVsRent.ok) failures.push("sale_vs_rent");
  if (!report.results.livingTask.taskId || !report.results.livingTask.reloadSameTaskId) failures.push("living_task");
  if (report.results.pilotAccess.authorized?.allowed !== true) failures.push("authorized_office");
  if (report.results.pilotAccess.unauthorized?.allowed !== false) failures.push("unauthorized_office");

  await cleanupFixtures();
  report.cleanup = "completed";
  writeFileSync(path.join(OUT, "production-pilot-controlled-e2e.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ runId: RUN_ID, failures, report: report.results }, null, 2));
  process.exit(failures.length ? 2 : 0);
}

main().catch(async (error) => {
  console.error(error);
  try { await cleanupFixtures(); } catch {}
  process.exit(1);
});
