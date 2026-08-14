/**
 * Live staging verification for /admin console.
 * Uses FIREBASE_SERVICE_ACCOUNT_JSON (iaqar-ai-staging).
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL = process.env.STAGING_HOSTING_URL || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_PHONE = "0511123456";
const OFFICE_PASSWORD = "StagingLogo9";
const ADMIN_EMAIL = String(process.env.IAQAR_STAGING_ADMIN_EMAIL || "admin@iaqar-ai-staging.test").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.IAQAR_STAGING_ADMIN_PASSWORD || "StagingAdmin9!");

const projectId = "iaqar-ai-staging";
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, projectId);
if (!serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing or invalid");

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount), projectId });
}
const auth = getAuth();
const db = getFirestore();

const report = {
  publicBlocked: false,
  officeBlocked: false,
  adminAllowed: false,
  officesListed: 0,
  backfillRan: false,
  overviewOk: false,
  activityOk: false,
  auditOk: false,
  adminHtmlOk: false,
  suspendBlocksLogin: false,
  reactivateRestoresLogin: false,
  subscriptionPersists: false,
  licensePersists: false,
  approvalPreservesOfficeId: false,
  approvedOfficePersists: false,
  noDuplicateOffice: false
};

async function ensurePlatformAdmin() {
  let user;
  try {
    user = await auth.getUserByEmail(ADMIN_EMAIL);
    user = await auth.updateUser(user.uid, { password: ADMIN_PASSWORD, disabled: false, emailVerified: true });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { platformAdmin: true, admin: true });
  return user;
}

async function getIdToken(email, password) {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const signRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const body = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(`signIn failed ${email}: ${signRes.status} ${JSON.stringify(body)}`);
  return body.idToken;
}

async function getOfficeIdToken() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: OFFICE_PHONE, password: OFFICE_PASSWORD, apiKey })
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.customToken) {
    throw new Error(`office phone-login failed: ${loginRes.status}`);
  }
  const signRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: loginBody.customToken, returnSecureToken: true })
  });
  const signBody = await signRes.json().catch(() => ({}));
  if (!signRes.ok || !signBody.idToken) throw new Error("office custom token sign-in failed");
  return signBody.idToken;
}

async function adminFetch(path, token, options = {}) {
  const response = await fetch(`${WORKER}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function main() {
  const html = await fetch(`${STAGING_URL}/admin`).then((r) => r.text());
  report.adminHtmlOk = html.includes("لوحة إدارة المنصة") && html.includes("admin-console.js");

  const publicRes = await fetch(`${WORKER}/admin/overview`);
  const publicBody = await publicRes.json().catch(() => ({}));
  report.publicBlocked = publicRes.status === 401 && publicBody.error === "auth_required";

  await ensurePlatformAdmin();
  const adminToken = await getIdToken(ADMIN_EMAIL, ADMIN_PASSWORD);
  const officeToken = await getOfficeIdToken();

  const officeDenied = await adminFetch("/admin/overview", officeToken);
  report.officeBlocked = officeDenied.response.status === 403 && officeDenied.payload.error === "admin_required";

  const overview = await adminFetch("/admin/overview", adminToken);
  report.adminAllowed = overview.response.ok;
  report.overviewOk = overview.response.ok && typeof overview.payload.overview?.totalOffices === "number";

  const offices = await adminFetch("/admin/offices?tab=all&limit=100", adminToken);
  report.officesListed = Array.isArray(offices.payload.items) ? offices.payload.items.length : 0;

  const backfill = await adminFetch("/admin/migrate/backfill-offices", adminToken, { method: "POST", body: "{}" });
  report.backfillRan = backfill.response.ok;

  const activity = await adminFetch("/admin/activity?limit=50", adminToken);
  report.activityOk = activity.response.ok && Array.isArray(activity.payload.items);

  const audit = await adminFetch("/admin/audit-log?limit=20", adminToken);
  report.auditOk = audit.response.ok && Array.isArray(audit.payload.items);

  const officeId = "staging-logo-live-20260807";
  const suspend = await adminFetch("/admin/office/suspend", adminToken, {
    method: "POST",
    body: JSON.stringify({ officeId, reason: "staging verification suspend test" })
  });
  if (suspend.response.ok) {
    try {
      await getOfficeIdToken();
    } catch (_) {
      report.suspendBlocksLogin = true;
    }
    const reactivate = await adminFetch("/admin/office/reactivate", adminToken, {
      method: "POST",
      body: JSON.stringify({ officeId, reason: "staging verification restore" })
    });
    if (reactivate.response.ok) {
      try {
        await getOfficeIdToken();
        report.reactivateRestoresLogin = true;
      } catch (_) {
        report.reactivateRestoresLogin = false;
      }
    }
  }

  const subExpiry = "2027-06-01";
  const subUpdate = await adminFetch("/admin/office/subscription", adminToken, {
    method: "POST",
    body: JSON.stringify({ officeId, subscriptionStatus: "active", subscriptionExpiresAt: subExpiry })
  });
  if (subUpdate.response.ok) {
    const detail = await adminFetch(`/admin/office?officeId=${encodeURIComponent(officeId)}`, adminToken);
    const office = detail.payload.office || {};
    report.subscriptionPersists = office.subscriptionStatus === "active";
  }

  const licUpdate = await adminFetch("/admin/office/license", adminToken, {
    method: "POST",
    body: JSON.stringify({ officeId, licenseExpiresAt: "2027-12-01" })
  });
  if (licUpdate.response.ok) {
    const detail = await adminFetch(`/admin/office?officeId=${encodeURIComponent(officeId)}`, adminToken);
    report.licensePersists = Boolean(detail.payload.office?.licenseExpiresAt);
  }

  const testAppId = `broker_verify_${Date.now()}`;
  const testOfficeId = `staging-admin-verify-${Date.now().toString(36)}`;
  await db.collection("brokerApplications").doc(testAppId).set({
    brokerName: "وسيط تحقق إداري",
    phone: "0599999001",
    email: `verify-${Date.now()}@iaqar-staging.test`,
    falLicense: "1234567890",
    officeName: "مكتب تحقق إداري",
    status: "pending",
    applicantUid: "verify-applicant",
    createdAt: new Date().toISOString()
  });
  const approve = await adminFetch("/admin/broker-applications/action", adminToken, {
    method: "POST",
    body: JSON.stringify({ applicationId: testAppId, action: "approve", officeId: testOfficeId })
  });
  report.approvalPreservesOfficeId = approve.response.ok && approve.payload.officeId === testOfficeId;
  if (report.approvalPreservesOfficeId) {
    const approvedList = await adminFetch(`/admin/offices?tab=approved&search=${encodeURIComponent(testOfficeId)}`, adminToken);
    const found = (approvedList.payload.items || []).some((row) => row.officeId === testOfficeId);
    report.approvedOfficePersists = found;
    report.noDuplicateOffice = (approvedList.payload.items || []).filter((row) => row.officeId === testOfficeId).length === 1;
  } else {
    report.approvedOfficePersists = false;
    report.noDuplicateOffice = false;
  }

  const officeSnap = await db.collection("offices").limit(5).get();
  console.log(JSON.stringify({
    stagingUrl: STAGING_URL,
    worker: WORKER,
    adminEmail: ADMIN_EMAIL,
    officesInFirestore: officeSnap.size,
    report
  }, null, 2));

  const pass = Object.values(report).every(Boolean);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
