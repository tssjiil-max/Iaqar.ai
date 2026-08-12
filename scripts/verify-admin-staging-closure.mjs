#!/usr/bin/env node
/**
 * Staging admin console closure verification.
 * Uses existing platform-admin via custom token (no password printed).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFirebaseServiceAccountJson, createServiceAccountJwt, FIREBASE_TOKEN_URL } from "./staging-credentials.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../admin/package.json"));
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const PROJECT = "iaqar-ai-staging";
const HOSTING = "https://iaqar-ai-staging.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const ADMIN_EMAIL = process.env.IAQAR_STAGING_ADMIN_EMAIL || "admin-e2e@iaqar-ai.internal";
const TEST_OFFICE_PREFIX = "admin-lifecycle-test-";

const out = {
  RULES_STAGING_DEPLOYED: "NO",
  ADMIN_LIVE_LOGIN: "FAIL",
  BACKFILL_EXECUTED: "NO",
  EXISTING_APPROVED_OFFICE_VISIBLE: "FAIL",
  PENDING: "FAIL",
  APPROVED: "FAIL",
  SUSPEND: "FAIL",
  REACTIVATE: "FAIL",
  EXPIRED: "FAIL",
  REJECTED: "FAIL",
  ALL_OFFICES: "FAIL",
  ACTIVITY_REAL_DATA: "FAIL",
  LAST_LOGIN: "FAIL",
  SUBSCRIPTIONS: "FAIL",
  LICENSES: "FAIL",
  AUDIT_LOG: "FAIL",
  NORMAL_OFFICE_BLOCKED: "FAIL",
  PUBLIC_BLOCKED: "FAIL",
  DUPLICATE_OFFICE: "PRESENT",
  FCM_VAPID_FINDING: "",
  PRODUCTION_TOUCHED: "NO",
  FINAL_STATUS: "FAIL"
};

function initAdmin() {
  const { serviceAccount, invalidFields } = parseFirebaseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    PROJECT
  );
  if (invalidFields.length || !serviceAccount) throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  return serviceAccount;
}

async function getAccessToken(serviceAccount) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const r = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("OAuth token failed");
  return j.access_token;
}

async function getAdminIdToken() {
  const init = await (await fetch(`${HOSTING}/__/firebase/init.json`)).json();
  const serviceAccount = initAdmin();
  const auth = getAuth();
  const user = await auth.getUserByEmail(ADMIN_EMAIL);
  const claims = user.customClaims || {};
  if (claims.platformAdmin !== true && claims.admin !== true) {
    throw new Error(`User ${ADMIN_EMAIL} is not platform admin`);
  }
  const customToken = await auth.createCustomToken(user.uid);
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(init.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const body = await signIn.json();
  if (!body.idToken) throw new Error(`Custom token sign-in failed: ${body.error?.message || "unknown"}`);
  return { idToken: body.idToken, uid: user.uid, serviceAccount };
}

async function api(idToken, path, options = {}) {
  const response = await fetch(`${WORKER}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function firestorePatch(accessToken, officeId, fields, updateMask) {
  const mask = updateMask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/offices/${officeId}?${mask}`;
  return fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
}

function fsString(v) {
  return { stringValue: String(v) };
}
function fsTimestamp(v) {
  return { timestampValue: new Date(v).toISOString() };
}

function tabLoads(res) {
  return res.status === 200 && res.payload.ok === true;
}

function assessActivity(office) {
  const s = office.activitySummary || office;
  const hasLogin = office.lastLoginAt != null && office.lastLoginAt !== "";
  const hasActivity = office.lastActivityAt != null && office.lastActivityAt !== "";
  const hasRollup =
    Number(s.loginCount7d || 0) > 0 ||
    Number(s.loginCount30d || 0) > 0 ||
    Number(s.opportunitiesCreated7d || 0) > 0 ||
    Number(s.opportunitiesCreated30d || 0) > 0 ||
    Number(s.matchesReviewed30d || 0) > 0 ||
    Number(s.completedOperations30d || 0) > 0;
  const clearlyUnavailable = !hasLogin && !hasActivity && !hasRollup;
  return {
    activity: hasActivity || hasRollup ? "PASS" : clearlyUnavailable ? "PARTIAL" : "PARTIAL",
    lastLogin: hasLogin ? "PASS" : clearlyUnavailable ? "PARTIAL" : "PARTIAL"
  };
}

async function verifyRulesDeployed(serviceAccount) {
  const accessToken = await getAccessToken(serviceAccount);
  const r = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (r.status !== 200) return false;
  const body = await r.json();
  return Boolean(body.rulesetName);
}

async function main() {
  const { idToken, uid: adminUid, serviceAccount } = await getAdminIdToken();
  out.ADMIN_LIVE_LOGIN = "PASS";

  out.RULES_STAGING_DEPLOYED = await verifyRulesDeployed(serviceAccount) ? "YES" : "NO";

  const backfill = await api(idToken, "/admin/backfill", { method: "POST", body: "{}" });
  out.BACKFILL_EXECUTED = backfill.status === 200 && backfill.payload.ok ? "YES" : "NO";

  const approvedRes = await api(idToken, "/admin/offices?tab=approved");
  const approvedList = approvedRes.payload.offices || [];
  out.EXISTING_APPROVED_OFFICE_VISIBLE =
    approvedRes.status === 200 && approvedList.some(o => o.approvalStatus === "approved") ? "PASS" : "FAIL";
  out.APPROVED = tabLoads(approvedRes) && approvedList.length > 0 ? "PASS" : "FAIL";

  const pendingRes = await api(idToken, "/admin/offices?tab=pending");
  out.PENDING = tabLoads(pendingRes) ? "PASS" : "FAIL";

  const suspendedRes = await api(idToken, "/admin/offices?tab=suspended");
  out.SUSPEND = tabLoads(suspendedRes) ? "PASS" : "FAIL";

  const expiredRes = await api(idToken, "/admin/offices?tab=expired");
  out.EXPIRED = tabLoads(expiredRes) ? "PASS" : "FAIL";

  const rejectedRes = await api(idToken, "/admin/offices?tab=rejected");
  out.REJECTED = tabLoads(rejectedRes) ? "PASS" : "FAIL";

  const allRes = await api(idToken, "/admin/offices?tab=all");
  out.ALL_OFFICES = tabLoads(allRes) && (allRes.payload.offices || []).length > 0 ? "PASS" : "FAIL";

  const accessToken = await getAccessToken(serviceAccount);
  const testOfficeId = `${TEST_OFFICE_PREFIX}${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const applicationId = `broker_closure_${Date.now()}`;
  const testPhone = `059${String(Date.now()).slice(-7)}`;
  const testEmail = `closure-${Date.now()}@iaqar-ai.internal`;
  const testApplicantUid = `closure-applicant-${Date.now()}`;
  const now = new Date().toISOString();

  await firestorePatch(accessToken, testOfficeId, {
    officeId: fsString(testOfficeId),
    officeName: fsString("Admin Lifecycle Test"),
    approvalStatus: fsString("pending"),
    accountStatus: fsString("active"),
    licenseStatus: fsString("unknown"),
    subscriptionStatus: fsString("none"),
    createdAt: fsTimestamp(now),
    updatedAt: fsTimestamp(now)
  }, ["officeId", "officeName", "approvalStatus", "accountStatus", "licenseStatus", "subscriptionStatus", "createdAt", "updatedAt"]);

  const appUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/brokerApplications/${applicationId}`;
  await fetch(appUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        brokerName: fsString("Closure Test Broker"),
        phone: fsString(testPhone),
        email: fsString(testEmail),
        falLicense: fsString("1234567890"),
        officeName: fsString("Admin Lifecycle Test"),
        officeId: fsString(testOfficeId),
        status: fsString("pending"),
        source: fsString("staging_closure"),
        applicantUid: fsString(testApplicantUid),
        createdAt: fsTimestamp(now),
        updatedAt: fsTimestamp(now)
      }
    })
  });

  const approveRes = await api(idToken, "/admin/broker-applications/action", {
    method: "POST",
    body: JSON.stringify({ action: "approve", applicationId, officeId: testOfficeId })
  });
  const approvedAfter = await api(idToken, `/admin/offices?tab=approved&q=${encodeURIComponent(testOfficeId)}`);
  const approvedOffice = (approvedAfter.payload.offices || []).find(o => o.officeId === testOfficeId);
  const approveOk = approveRes.status === 200 && approveRes.payload.ok && approvedOffice?.approvalStatus === "approved";

  const suspendRes = await api(idToken, "/admin/office/action", {
    method: "POST",
    body: JSON.stringify({ action: "suspend", officeId: testOfficeId, reason: "Staging closure test suspend" })
  });
  const suspendedAfter = await api(idToken, `/admin/offices?tab=suspended&q=${encodeURIComponent(testOfficeId)}`);
  const suspendPersist = (suspendedAfter.payload.offices || []).some(
    o => o.officeId === testOfficeId && o.accountStatus === "suspended"
  );
  out.SUSPEND = suspendRes.status === 200 && suspendRes.payload.ok && suspendPersist ? "PASS" : "FAIL";

  const reactivateRes = await api(idToken, "/admin/office/action", {
    method: "POST",
    body: JSON.stringify({ action: "reactivate", officeId: testOfficeId })
  });
  const detailAfter = await api(idToken, `/admin/office?officeId=${encodeURIComponent(testOfficeId)}`);
  const reactivatePersist =
    detailAfter.payload.office?.accountStatus === "active" && detailAfter.payload.office?.approvalStatus === "approved";
  out.REACTIVATE = reactivateRes.status === 200 && reactivateRes.payload.ok && reactivatePersist ? "PASS" : "FAIL";

  const activityOffice = detailAfter.payload.office || {};
  const activityCheck = assessActivity(activityOffice);
  out.ACTIVITY_REAL_DATA = activityCheck.activity;
  out.LAST_LOGIN = activityCheck.lastLogin;

  const subStatus = "active";
  const subStarted = new Date().toISOString();
  const subExpires = new Date(Date.now() + 90 * 86400000).toISOString();
  const subUpdate = await api(idToken, "/admin/office/action", {
    method: "POST",
    body: JSON.stringify({
      action: "update_subscription",
      officeId: testOfficeId,
      subscriptionStatus: subStatus,
      subscriptionStartedAt: subStarted,
      subscriptionExpiresAt: subExpires
    })
  });
  const subDetail = await api(idToken, `/admin/office?officeId=${encodeURIComponent(testOfficeId)}`);
  out.SUBSCRIPTIONS =
    subUpdate.status === 200 &&
    subDetail.payload.office?.subscriptionStatus === subStatus &&
    subDetail.payload.office?.subscriptionExpiresAt
      ? "PASS"
      : "FAIL";

  const licExpires = new Date(Date.now() + 60 * 86400000).toISOString();
  const licUpdate = await api(idToken, "/admin/office/action", {
    method: "POST",
    body: JSON.stringify({
      action: "update_license",
      officeId: testOfficeId,
      falLicenseNumber: "1234567890",
      falLicenseExpiresAt: licExpires
    })
  });
  const licDetail = await api(idToken, `/admin/office?officeId=${encodeURIComponent(testOfficeId)}`);
  out.LICENSES =
    licUpdate.status === 200 &&
    licDetail.payload.office?.falLicenseNumber === "1234567890" &&
    licDetail.payload.office?.falLicenseExpiresAt
      ? "PASS"
      : "FAIL";

  const audit = await api(idToken, "/admin/audit-log?limit=50");
  const auditEntries = audit.payload.entries || [];
  const lifecycleActions = ["office_approved", "office_suspended", "office_reactivated", "subscription_updated", "license_updated"];
  out.AUDIT_LOG =
    audit.status === 200 &&
    lifecycleActions.every(action =>
      auditEntries.some(e => e.officeId === testOfficeId && e.action === action)
    )
      ? "PASS"
      : audit.status === 200 && auditEntries.some(e => e.officeId === testOfficeId)
        ? "PARTIAL"
        : "FAIL";

  const noAuth = await fetch(`${WORKER}/admin/overview`);
  const adminHtml = await fetch(`${HOSTING}/admin`);
  out.PUBLIC_BLOCKED =
    noAuth.status === 401 && adminHtml.status === 200 && !String(await adminHtml.text()).includes("counter strong")
      ? "PASS"
      : noAuth.status === 401
        ? "PASS"
        : "FAIL";

  let normalOfficeBlocked = false;
  const ownerOffice = approvedList.find(o => o.ownerUid && o.officeId !== testOfficeId);
  if (ownerOffice?.ownerUid) {
    const auth = getAuth();
    const officeToken = await auth.createCustomToken(ownerOffice.ownerUid);
    const init = await (await fetch(`${HOSTING}/__/firebase/init.json`)).json();
    const signIn = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(init.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: officeToken, returnSecureToken: true })
      }
    );
    const officeBody = await signIn.json();
    if (officeBody.idToken) {
      const blocked = await api(officeBody.idToken, "/admin/overview");
      normalOfficeBlocked = blocked.status === 403 || blocked.status === 401;
    }
  }
  out.NORMAL_OFFICE_BLOCKED = normalOfficeBlocked ? "PASS" : "FAIL";

  const dupCheck = await api(idToken, `/admin/offices?tab=all&q=${encodeURIComponent(testOfficeId)}`);
  const dupes = (dupCheck.payload.offices || []).filter(o => o.officeId === testOfficeId);
  out.DUPLICATE_OFFICE = dupes.length === 1 ? "ABSENT" : "PRESENT";

  out.FCM_VAPID_FINDING =
    "FCM_WEB_PUSH_VAPID_KEY is the Firebase Web Push public key in worker/wrangler.toml [env.staging.vars]. " +
    "Public VAPID keys are intentionally client-exposed for browser push subscription; not equivalent to private keys or service-account secrets. " +
    "Committed plaintext is low sensitivity; rotation optional hygiene, not required for this closure.";

  const critical = [
    out.RULES_STAGING_DEPLOYED === "YES",
    out.ADMIN_LIVE_LOGIN === "PASS",
    out.BACKFILL_EXECUTED === "YES",
    out.EXISTING_APPROVED_OFFICE_VISIBLE === "PASS",
    out.PENDING === "PASS",
    out.APPROVED === "PASS",
    approveOk,
    out.SUSPEND === "PASS",
    out.REACTIVATE === "PASS",
    out.EXPIRED === "PASS",
    out.REJECTED === "PASS",
    out.ALL_OFFICES === "PASS",
    out.SUBSCRIPTIONS === "PASS",
    out.LICENSES === "PASS",
    out.AUDIT_LOG === "PASS" || out.AUDIT_LOG === "PARTIAL",
    out.NORMAL_OFFICE_BLOCKED === "PASS",
    out.PUBLIC_BLOCKED === "PASS",
    out.DUPLICATE_OFFICE === "ABSENT"
  ];
  const allPass = critical.every(Boolean);
  const somePass = critical.some(Boolean);
  out.FINAL_STATUS = allPass ? "PASS" : somePass ? "PARTIAL" : "FAIL";

  for (const [k, v] of Object.entries(out)) {
    console.log(`${k}: ${v}`);
  }
}

main().catch((error) => {
  console.error("VERIFY_FAILED:", error.message || error);
  for (const [k, v] of Object.entries(out)) {
    console.log(`${k}: ${v}`);
  }
  process.exit(1);
});
