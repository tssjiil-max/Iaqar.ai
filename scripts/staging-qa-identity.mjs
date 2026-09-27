/**
 * Shared, self-contained QA identity for deployed-Staging E2E scripts.
 *
 * Every run gets its own Firebase Auth uid and its own membership document in
 * the dedicated QA office, both carrying the run's testRunId. Nothing is copied
 * from real offices, nothing depends on loginDirectory/phone login, and cleanup
 * only ever removes what the same run created. Per-run uids keep concurrent runs
 * from overwriting or deleting each other's membership.
 *
 * Firebase SDK objects are injected so this module stays unit-testable without
 * firebase-admin installed.
 */

export const STAGING_PROJECT_ID = "iaqar-ai-staging";
export const QA_OFFICE_ID = "qa-e2e-dedicated";
export const QA_OFFICE_PATH = `offices/${QA_OFFICE_ID}`;
export const QA_UID_PREFIX = "qa-e2e-";

export function refuse(reason) {
  throw new Error(`QA_GUARD_REFUSED: ${reason}`);
}

/** Throws unless the service account belongs to the Staging project. */
export function assertStagingServiceAccount(serviceAccount) {
  const projectId = String(serviceAccount?.project_id || serviceAccount?.projectId || "");
  if (projectId !== STAGING_PROJECT_ID) refuse(`service account project ${projectId || "(none)"} is not ${STAGING_PROJECT_ID}`);
  return true;
}

/** Throws unless the hosting URL is a Staging channel and its Firebase config targets Staging. */
export async function stagingHostingConfig(stagingUrl, fetchImpl = globalThis.fetch) {
  const host = new URL(stagingUrl).hostname;
  if (!host.startsWith(`${STAGING_PROJECT_ID}--`)) refuse(`hosting URL is not an ${STAGING_PROJECT_ID} channel: ${stagingUrl}`);
  const response = await fetchImpl(`${stagingUrl}/__/firebase/init.json`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.apiKey) throw new Error(`firebase init failed ${response.status}`);
  if (body.projectId && body.projectId !== STAGING_PROJECT_ID) refuse(`hosting project is ${body.projectId}`);
  return body;
}

/** A per-run QA uid: `qa-e2e-<role>-<runId>` (Firebase uid charset, max 128). */
export function qaRunUid(role, runId) {
  const safe = (value) => String(value || "").replace(/[^A-Za-z0-9_-]/g, "-");
  const uid = `${QA_UID_PREFIX}${safe(role)}-${safe(runId)}`.slice(0, 128);
  if (!safe(role) || !safe(runId)) refuse("QA uid needs a role and a runId");
  return uid;
}

export function assertQaPath(ref) {
  const refPath = String(ref?.path || "");
  if (!refPath.startsWith(`${QA_OFFICE_PATH}/`)) refuse(`path outside ${QA_OFFICE_PATH}: ${refPath}`);
  return refPath;
}

/**
 * Ensure the dedicated QA office exists (refusing any non-fixture office with the
 * same id) and create this run's membership. Must be called after the Staging
 * guards above.
 */
export async function ensureQaOfficeMember({ db, FieldValue, runId, uid, role = "manager" }) {
  if (!String(uid).startsWith(QA_UID_PREFIX) || !String(uid).endsWith(String(runId).replace(/[^A-Za-z0-9_-]/g, "-"))) {
    refuse(`uid ${uid} is not a per-run QA uid for ${runId}`);
  }
  const office = db.collection("offices").doc(QA_OFFICE_ID);
  const snap = await office.get();
  if (snap.exists && (snap.data() || {}).isTestFixture !== true) {
    refuse(`${QA_OFFICE_PATH} exists but is not marked isTestFixture`);
  }
  await office.set({
    officeName: "QA E2E Dedicated",
    displayName: "QA E2E Dedicated",
    isTestFixture: true,
    createdBy: "E2E",
    platformOpportunityOnboardingAckAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  const memberRef = office.collection("members").doc(uid);
  assertQaPath(memberRef);
  await memberRef.set({
    uid,
    role,
    active: true,
    isTestFixture: true,
    testRunId: runId,
    createdBy: "E2E",
    updatedAt: FieldValue.serverTimestamp()
  });
  return { office, memberRef };
}

/** Admin custom token for the per-run uid, exchanged for an ID token against Staging. */
export async function signInQaUser({ auth, stagingUrl, uid, fetchImpl = globalThis.fetch }) {
  const { apiKey } = await stagingHostingConfig(stagingUrl, fetchImpl);
  const customToken = await auth.createCustomToken(uid, { qaFixture: true });
  const response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) throw new Error(`custom-token sign-in failed ${response.status}`);
  return { customToken, idToken: body.idToken, apiKey };
}

/**
 * Remove only this run's membership and its Staging Auth user. A membership that
 * carries another run's testRunId, or a uid that is not this run's QA uid, is left
 * untouched.
 */
export async function removeQaIdentity({ db, auth, runId, uid }) {
  const removed = { member: false, authUser: false };
  if (!String(uid).startsWith(QA_UID_PREFIX) || !String(uid).endsWith(String(runId).replace(/[^A-Za-z0-9_-]/g, "-"))) {
    return removed;
  }
  const memberRef = db.collection("offices").doc(QA_OFFICE_ID).collection("members").doc(uid);
  assertQaPath(memberRef);
  const member = await memberRef.get();
  if (member.exists && (member.data() || {}).testRunId === runId) {
    await memberRef.delete();
    removed.member = true;
  }
  if (auth?.deleteUser) {
    try {
      await auth.deleteUser(uid);
      removed.authUser = true;
    } catch (error) {
      if (!String(error?.code || error?.message || "").includes("user-not-found")) throw error;
    }
  }
  return removed;
}
