/**
 * Staging E2E — opportunity save persistence for advertiserRole (no UI).
 * Creates a temporary incomplete opportunity, patches via Worker API, verifies Firestore.
 */
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import { buildAdvertiserDataPatch } from "../public/js/advertiser-phone-domain.js";
import { mergeIncompleteFormPreview } from "../public/js/opportunity-workspace-domain.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const STAGING_URL =
  process.env.STAGING_HOSTING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_ID = "staging-logo-live-20260807";
const LOGIN_PHONE = "0511123456";
const LOGIN_PASSWORD = "StagingLogo9";
const E2E_TAG = `save_persist_${Date.now().toString(36)}`;
const projectId = "iaqar-ai-staging";

const { serviceAccount } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  projectId
);
const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId });
const db = getFirestore(app);

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

async function patchOpportunity(token, opportunityId, patch) {
  console.info("[iaqar-save-e2e] patch request", { opportunityId, patch });
  const res = await fetch(`${WORKER}/opportunity/patch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Office-Id": OFFICE_ID
    },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId, patch })
  });
  const body = await res.json().catch(() => ({}));
  console.info("[iaqar-save-e2e] patch response", { status: res.status, body });
  if (!res.ok) throw new Error(`patch failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function readOpportunity(opportunityId) {
  const snap = await db.collection("offices").doc(OFFICE_ID)
    .collection("opportunities").doc(opportunityId).get();
  if (!snap.exists) throw new Error(`opportunity missing: ${opportunityId}`);
  return { id: opportunityId, ...snap.data() };
}

function buildClientPatch(existing, formData) {
  const advResult = buildAdvertiserDataPatch(existing, formData);
  if (!advResult.ok) throw new Error(advResult.error || "advertiser patch failed");
  const mergedPreview = mergeIncompleteFormPreview(existing, formData);
  const readiness = evaluateMatchingReadiness(mergedPreview);
  return {
    ...advResult.patch,
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing || []
  };
}

async function main() {
  const opportunityId = `opp_${E2E_TAG}`;
  const seed = {
    officeId: OFFICE_ID,
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "الوبرة",
    price: 1500000,
    priceOrBudget: 1500000,
    advertiserPhoneNormalized: "+966512345678",
    contactPhone: "+966512345678",
    advertiserRole: "UNKNOWN",
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["advertiserRole"],
    lifecycleStatus: "ACTIVE",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    version: 1,
    sourceType: "e2e_save_persist"
  };

  console.log(`Creating seed opportunity ${opportunityId}`);
  await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(opportunityId).set(seed);

  const before = await readOpportunity(opportunityId);
  const beforeReadiness = evaluateMatchingReadiness(before);
  console.log("Before save:", {
    advertiserRole: before.advertiserRole,
    missing: beforeReadiness.matchingReadinessMissing,
    complete: 7 - beforeReadiness.matchingReadinessMissing.length
  });
  if (!beforeReadiness.matchingReadinessMissing.includes("advertiserRole")) {
    throw new Error("seed opportunity should be missing advertiserRole");
  }

  const token = await getAuthToken();
  const patch = buildClientPatch(before, { advertiserRole: "مالك" });
  if (patch.advertiserRole !== "OWNER") {
    throw new Error(`expected OWNER patch, got ${patch.advertiserRole}`);
  }

  await patchOpportunity(token, opportunityId, patch);

  const afterPatch = await readOpportunity(opportunityId);
  const afterReadiness = evaluateMatchingReadiness(afterPatch);
  console.log("After save (Firestore re-read):", {
    advertiserRole: afterPatch.advertiserRole,
    matchingReadiness: afterPatch.matchingReadiness,
    missing: afterReadiness.matchingReadinessMissing,
    complete: 7 - afterReadiness.matchingReadinessMissing.length
  });

  if (afterPatch.advertiserRole !== "OWNER") {
    throw new Error(`persisted advertiserRole=${afterPatch.advertiserRole}, expected OWNER`);
  }
  if (!afterReadiness.isReadyForMatching) {
    throw new Error(`still incomplete after save: ${afterReadiness.matchingReadinessMissing.join(",")}`);
  }

  // Simulate full refresh — read again from Firestore
  const afterRefresh = await readOpportunity(opportunityId);
  const refreshReadiness = evaluateMatchingReadiness(afterRefresh);
  if (afterRefresh.advertiserRole !== "OWNER" || !refreshReadiness.isReadyForMatching) {
    throw new Error("persistence lost after simulated refresh");
  }

  console.log("PASS staging save persistence e2e");

  await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(opportunityId).delete();
  console.log(`Cleaned up ${opportunityId}`);
}

main().catch((error) => {
  console.error("FAIL staging save persistence e2e:", error);
  process.exit(1);
});
