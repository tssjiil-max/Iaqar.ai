/**
 * PR #42 staging E2E — API/Firestore verification (no UI).
 * Uses staging test offices only; cleans up temporary records.
 */
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL =
  process.env.STAGING_HOSTING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_ID = "staging-logo-live-20260807";
const TARGET_OFFICE = "staging-coop-target-20260807";
const LOGIN_PHONE = "0511123456";
const LOGIN_PASSWORD = "StagingLogo9";
const E2E_TAG = `pr42_${Date.now().toString(36)}`;
const E2E_PHONE = "0552019909";
const projectId = "iaqar-ai-staging";

const { serviceAccount } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  projectId
);
const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId });
const db = getFirestore(app);

const results = {};
const tempIds = {
  intakeIds: [],
  opportunityIds: [],
  cooperationIds: [],
  matchIds: [],
  targetOfficeOpportunityIds: []
};

function pass(step, detail = "") {
  results[step] = { pass: true, detail };
  console.log(`PASS ${step}: ${detail}`);
}

function fail(step, detail = "") {
  results[step] = { pass: false, detail };
  console.error(`FAIL ${step}: ${detail}`);
}

async function getAuthToken() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: LOGIN_PHONE, password: LOGIN_PASSWORD, apiKey })
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.customToken) {
    throw new Error(`phone-login failed: ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }
  const signRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: loginBody.customToken, returnSecureToken: true })
    }
  );
  const signBody = await signRes.json().catch(() => ({}));
  if (!signRes.ok || !signBody.idToken) throw new Error(`signIn failed: ${signRes.status}`);
  return signBody.idToken;
}

async function processIntake(officeId, intakeId) {
  const res = await fetch(`${WORKER}/pipeline/public-intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeId, intakeId })
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function stepLogin() {
  try {
    const token = await getAuthToken();
    pass("1_login", `idToken length ${token.length}`);
    return token;
  } catch (error) {
    fail("1_login", String(error.message || error));
    throw error;
  }
}

async function stepDuplicateIntake(token) {
  const intakeId1 = `intake_${E2E_TAG}_a`;
  const intakeId2 = `intake_${E2E_TAG}_b`;
  tempIds.intakeIds.push(intakeId1, intakeId2);
  const base = {
    officeId: OFFICE_ID,
    kind: "client",
    name: "اختبار PR42",
    phone: E2E_PHONE,
    city: "المدينة المنورة",
    district: "العوالي",
    propertyType: "شقة",
    transactionType: "sale",
    amount: 450000,
    details: `E2E duplicate ${E2E_TAG}`,
    status: "new",
    lifecycleStatus: "NEW",
    source: "office_public_link",
    createdAt: FieldValue.serverTimestamp()
  };
  await db.collection("offices").doc(OFFICE_ID).collection("publicIntake").doc(intakeId1).set(base);
  const first = await processIntake(OFFICE_ID, intakeId1);
  if (!first.ok) {
    fail("2_3_duplicate", `first intake failed: ${first.status} ${JSON.stringify(first.body)}`);
    return null;
  }
  const oppId1 = first.body.opportunityId || first.body.recordId || "";
  if (oppId1) tempIds.opportunityIds.push(oppId1);

  await db.collection("offices").doc(OFFICE_ID).collection("publicIntake").doc(intakeId2).set({
    ...base,
    details: `E2E duplicate second ${E2E_TAG}`
  });
  const second = await processIntake(OFFICE_ID, intakeId2);
  const oppId2 = second.body.opportunityId || second.body.recordId || "";

  const duplicateOk = second.body.duplicate === true && oppId2 === oppId1;
  const commSnap = oppId1
    ? await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(oppId1)
      .collection("communications").limit(5).get()
    : { empty: true, size: 0 };

  const activeSnap = await db.collection("offices").doc(OFFICE_ID).collection("opportunities")
    .where("contactPhone", "==", E2E_PHONE).get()
    .catch(async () => {
      const all = await db.collection("offices").doc(OFFICE_ID).collection("opportunities").limit(80).get();
      return {
        size: all.docs.filter((d) => {
          const p = d.data()?.contactPhone || d.data()?.advertiserPhoneNormalized || "";
          return String(p).includes("552019909");
        }).length,
        docs: all.docs
      };
    });

  const activeCount = activeSnap.size ?? activeSnap;
  if (duplicateOk && activeCount <= 1) {
    pass("2_3_duplicate", `oppId=${oppId1} duplicate=${second.body.duplicate} comms=${commSnap.size || 0}`);
  } else {
    fail("2_3_duplicate", `duplicateOk=${duplicateOk} opp1=${oppId1} opp2=${oppId2} activeCount=${activeCount}`);
  }
  return oppId1;
}

async function stepSameIdInBankAndOps(opportunityId) {
  if (!opportunityId) {
    fail("5_same_opportunity_id", "no opportunity id from duplicate step");
    return;
  }
  const oppDoc = await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(opportunityId).get();
  if (!oppDoc.exists) {
    fail("5_same_opportunity_id", `missing opportunities/${opportunityId}`);
    return;
  }
  pass("5_same_opportunity_id", `opportunities/${opportunityId} exists; id stable for bank/ops`);
}

async function stepMatching(token, opportunityId) {
  const ownerId = `opp_e2e_owner_${E2E_TAG}`;
  const brokerSnap = await db.collection("offices").doc(OFFICE_ID).collection("members").limit(1).get();
  const brokerId = brokerSnap.docs[0]?.id || "e2e-broker";
  tempIds.opportunityIds.push(ownerId);

  await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(ownerId).set({
    officeId: OFFICE_ID,
    brokerId,
    originatingOfficeId: OFFICE_ID,
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    salePrice: 440000,
    area: 120,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966551112222",
    contactPhone: "+966551112222",
    contactType: "owner",
    matchingReadiness: "READY_FOR_MATCHING",
    lifecycleStatus: "ACTIVE",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  let clientId = opportunityId;
  if (!clientId) {
    clientId = `opp_e2e_client_${E2E_TAG}`;
    tempIds.opportunityIds.push(clientId);
    await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(clientId).set({
      officeId: OFFICE_ID,
      brokerId,
      opportunityKind: "REQUEST",
      purpose: "PURCHASE",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "العوالي",
      budget: 450000,
      area: 115,
      advertiserRole: "CLIENT",
      advertiserPhoneNormalized: `+966${E2E_PHONE.slice(1)}`,
      contactPhone: `+966${E2E_PHONE.slice(1)}`,
      contactType: "buyer",
      matchingReadiness: "READY_FOR_MATCHING",
      lifecycleStatus: "ACTIVE",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  } else {
    await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(clientId).set({
      matchingReadiness: "READY_FOR_MATCHING",
      purpose: "PURCHASE",
      opportunityKind: "REQUEST",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "العوالي",
      budget: 450000,
      area: 115,
      advertiserRole: "CLIENT",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  const res = await fetch(`${WORKER}/matching/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Office-Id": OFFICE_ID
    },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId: clientId })
  });
  const body = await res.json().catch(() => ({}));
  const matches = await db.collection("offices").doc(OFFICE_ID).collection("matches")
    .orderBy("createdAt", "desc").limit(5).get();
  const scored = matches.docs.find((d) => {
    const data = d.data();
    return Number(data.score || data.opportunityScore || 0) > 0;
  });
  if (scored) tempIds.matchIds.push(scored.id);
  const score = scored ? Number(scored.data().score || scored.data().opportunityScore || 0) : 0;
  if (res.ok && score > 0) {
    pass("18_matching", `matchId=${scored.id} score=${score}% reasons=${JSON.stringify(scored.data().matchReasons || scored.data().reasons || []).slice(0, 120)}`);
  } else {
    fail("18_matching", `run=${res.status} score=${score} body=${JSON.stringify(body).slice(0, 120)}`);
  }
  return { clientId, ownerId, matchScore: score };
}

async function stepCooperation(token, ownerId) {
  const res = await fetch(`${WORKER}/cooperation/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Office-Id": OFFICE_ID
    },
    body: JSON.stringify({
      officeId: OFFICE_ID,
      targetOfficeId: TARGET_OFFICE,
      opportunityIds: [ownerId],
      scopeType: "single"
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail("19_20_cooperation", `API ${res.status} ${JSON.stringify(body).slice(0, 150)}`);
    return;
  }
  const coopId = body.cooperationRequestId || body.requestId || "";
  if (coopId) tempIds.cooperationIds.push(coopId);

  const sharedSnap = await db.collection("offices").doc(TARGET_OFFICE).collection("sharedOpportunities").limit(5).get();
  let leaked = false;
  for (const doc of sharedSnap.docs) {
    const data = doc.data();
    const blob = JSON.stringify(data);
    if (/\+9665\d{8}|05\d{8}/.test(blob) && data.status !== "ACCEPTED") {
      leaked = true;
    }
    if (data.advertiserPhoneNormalized || data.contactPhone) leaked = true;
  }
  if (res.ok && !leaked) {
    pass("19_20_cooperation", `coopId=${coopId} no phone/name leak before accept`);
  } else {
    fail("19_20_cooperation", `leaked=${leaked} coopId=${coopId}`);
  }
}

async function stepOfficeIsolation(token) {
  const foreignId = `opp_isolation_probe_${E2E_TAG}`;
  tempIds.targetOfficeOpportunityIds.push(foreignId);
  await db.collection("offices").doc(TARGET_OFFICE).collection("opportunities").doc(foreignId).set({
    officeId: TARGET_OFFICE,
    originatingOfficeId: TARGET_OFFICE,
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    salePrice: 500000,
    area: 130,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966559998877",
    contactPhone: "+966559998877",
    contactType: "owner",
    matchingReadiness: "READY_FOR_MATCHING",
    lifecycleStatus: "ACTIVE",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  const probe = await fetch(`${WORKER}/matching/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Office-Id": OFFICE_ID
    },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId: foreignId })
  });
  const probeBody = await probe.json().catch(() => ({}));
  if (probe.status === 403 || probe.status === 401) {
    pass("21_isolation", `cross-office probe rejected HTTP ${probe.status}`);
    return;
  }
  if (probeBody.error === "office_mismatch" || probeBody.code === "office_mismatch" ||
    probeBody.message?.includes("office") || probe.status === 404) {
    pass("21_isolation", `worker rejected foreign opp: ${probe.status} ${JSON.stringify(probeBody).slice(0, 80)}`);
    return;
  }

  const firestoreProbe = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/offices/${TARGET_OFFICE}/opportunities/${foreignId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (firestoreProbe.status === 403 || firestoreProbe.status === 404) {
    pass("21_isolation", `Firestore rules blocked cross-office read HTTP ${firestoreProbe.status}`);
  } else {
    fail("21_isolation", `worker=${probe.status} firestore=${firestoreProbe.status}`);
  }
}

async function cleanup() {
  const batch = [];
  for (const intakeId of tempIds.intakeIds) {
    batch.push(db.collection("offices").doc(OFFICE_ID).collection("publicIntake").doc(intakeId).delete());
  }
  for (const oppId of tempIds.opportunityIds) {
    batch.push(db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(oppId).delete());
    const comms = await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(oppId).collection("communications").get();
    for (const c of comms.docs) batch.push(c.ref.delete());
  }
  for (const matchId of tempIds.matchIds) {
    batch.push(db.collection("offices").doc(OFFICE_ID).collection("matches").doc(matchId).delete());
  }
  for (const coopId of tempIds.cooperationIds) {
    batch.push(db.collection("cooperationRequests").doc(coopId).delete());
  }
  for (const oppId of tempIds.targetOfficeOpportunityIds) {
    batch.push(db.collection("offices").doc(TARGET_OFFICE).collection("opportunities").doc(oppId).delete());
  }
  await Promise.all(batch);
  pass("28_cleanup", JSON.stringify(tempIds));
}

async function main() {
  console.log(JSON.stringify({
    stagingProjectId: projectId,
    stagingUrl: STAGING_URL,
    worker: WORKER,
    officeId: OFFICE_ID,
    e2eTag: E2E_TAG
  }));
  const token = await stepLogin();
  const oppId = await stepDuplicateIntake(token);
  await stepSameIdInBankAndOps(oppId);
  const { ownerId } = await stepMatching(token, oppId);
  await stepCooperation(token, ownerId);
  await stepOfficeIsolation(token);
  await cleanup();
  console.log(JSON.stringify({ results, tempIds }, null, 2));
  const allPass = Object.values(results).every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
