import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import {
  createServiceAccountJwt,
  FIREBASE_TOKEN_URL,
  parseFirebaseServiceAccountJson
} from "./staging-credentials.mjs";
import {
  assertQaPath,
  assertStagingServiceAccount,
  QA_OFFICE_ID,
  STAGING_PROJECT_ID
} from "./staging-qa-identity.mjs";
import { dueViewingReminders, VIEWING_REMINDER_KIND } from "../worker/src/viewing-reminder-domain.js";

const outDir = process.env.DIAGNOSTIC_OUT || process.cwd();
const runId = `viewing-query-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const fixtureId = `qa_${randomUUID().replace(/-/g, "")}`;
const report = {
  runId, projectId: STAGING_PROJECT_ID, fixture: { officeId: QA_OFFICE_ID, matchId: fixtureId },
  notificationsAttempted: false, externalMessagesSent: false, queries: [], cleanup: { completed: false }
};

function queryBody(lowerValue, upperValue) {
  return {
    structuredQuery: {
      from: [{ collectionId: "matches", allDescendants: true }],
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field: { fieldPath: "appointmentAt" }, op: "GREATER_THAN", value: lowerValue } },
        { fieldFilter: { field: { fieldPath: "appointmentAt" }, op: "LESS_THAN_OR_EQUAL", value: upperValue } }
      ] } },
      orderBy: [{ field: { fieldPath: "appointmentAt" }, direction: "ASCENDING" }],
      limit: 200
    }
  };
}

async function accessToken(serviceAccount) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Google access token failed (${response.status})`);
  return body.access_token;
}

async function runQuery(token, label, lowerValue, upperValue) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${STAGING_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(queryBody(lowerValue, upperValue))
  });
  const body = await response.json().catch(() => ({}));
  const error = body?.error;
  const rows = Array.isArray(body) ? body.filter((row) => row?.document) : [];
  const targetName = `projects/${STAGING_PROJECT_ID}/databases/(default)/documents/offices/${QA_OFFICE_ID}/matches/${fixtureId}`;
  const result = { label, httpStatus: response.status, ok: response.ok, returnedDocuments: rows.length,
    fixtureReturned: rows.some((row) => row.document.name === targetName) };
  if (error) result.error = { code: error.code, status: error.status, message: String(error.message || "").slice(0, 400) };
  report.queries.push(result);
  if (!response.ok || error) throw new Error(`${label} Firestore query failed (${response.status} ${error?.status || ""})`);
  return result;
}

async function main() {
  const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, STAGING_PROJECT_ID);
  if (parsed.invalidFields.length) throw new Error(`Invalid Staging credential fields: ${parsed.invalidFields.join(", ")}`);
  const serviceAccount = parsed.serviceAccount;
  assertStagingServiceAccount(serviceAccount);
  if (serviceAccount.project_id !== STAGING_PROJECT_ID) throw new Error("Refusing non-Staging project");

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: STAGING_PROJECT_ID });
  const db = admin.firestore();
  const officeRef = db.collection("offices").doc(QA_OFFICE_ID);
  const office = await officeRef.get();
  if (!office.exists || office.data()?.isTestFixture !== true) throw new Error("QA office guard refused: dedicated fixture office missing or unmarked");

  const now = new Date();
  const appointmentAt = new Date(now.getTime() + 9 * 60_000);
  const fixtureRef = officeRef.collection("matches").doc(fixtureId);
  assertQaPath(fixtureRef);
  await fixtureRef.create({
    officeId: QA_OFFICE_ID,
    appointmentAt: admin.firestore.Timestamp.fromDate(appointmentAt),
    appointmentStatus: "CONFIRMED_BY_BROKER",
    livingStage: "APPOINTMENT_CONFIRMED",
    isTestFixture: true,
    testRunId: runId,
    createdBy: "STAGING_VIEWING_REMINDER_QUERY_DIAGNOSTIC"
  });
  report.fixture.created = true;

  try {
    const token = await accessToken(serviceAccount);
    const earliest = new Date(now.getTime() - 15 * 60_000);
    const latest = new Date(now.getTime() + 2 * 60 * 60_000);
    const timestampQuery = await runQuery(token, "timestamp", { timestampValue: earliest.toISOString() }, { timestampValue: latest.toISOString() });
    const legacyQuery = await runQuery(token, "legacy-string", { stringValue: earliest.toISOString() }, { stringValue: latest.toISOString() });
    if (!timestampQuery.fixtureReturned) throw new Error("Timestamp query succeeded but did not return the isolated fixture");
    const due = dueViewingReminders({
      appointmentAt: appointmentAt.toISOString(), appointmentStatus: "CONFIRMED_BY_BROKER", livingStage: "APPOINTMENT_CONFIRMED"
    }, now, 10);
    report.dueKinds = due.map((item) => item.kind);
    if (!due.some((item) => item.kind === VIEWING_REMINDER_KIND.TEN_MINUTES)) throw new Error("Synthetic confirmed appointment was not due for ten-minute reminder");
    report.legacyIndexQuerySucceeded = legacyQuery.ok;
    report.status = "passed";
  } finally {
    const current = await fixtureRef.get();
    if (current.exists && current.data()?.testRunId === runId && current.data()?.isTestFixture === true) {
      await fixtureRef.delete();
      report.cleanup.completed = true;
    }
    await admin.app().delete();
  }
}

try {
  await main();
} catch (error) {
  report.status = "failed";
  report.error = String(error?.message || error).slice(0, 500);
} finally {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/staging-viewing-reminder-query-diagnostic.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (report.status !== "passed") process.exitCode = 1;
