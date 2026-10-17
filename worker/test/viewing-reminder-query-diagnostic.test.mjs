import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dueViewingReminders, VIEWING_REMINDER_KIND } from "../src/viewing-reminder-domain.js";

const diagnostic = await readFile(new URL("../../scripts/staging-viewing-reminder-query-diagnostic.mjs", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("diagnostic query contract stays aligned with scheduled reminder candidate query", () => {
  const workerStart = worker.indexOf("async function queryViewingReminderCandidates(");
  const workerEnd = worker.indexOf("\nasync function persistViewingAlert(", workerStart);
  assert.notEqual(workerStart, -1);
  assert.notEqual(workerEnd, -1);
  const source = worker.slice(workerStart, workerEnd);
  for (const fragment of [
    'collectionId: "matches", allDescendants: true',
    'fieldPath: "appointmentAt" }, op: "GREATER_THAN"',
    'fieldPath: "appointmentAt" }, op: "LESS_THAN_OR_EQUAL"',
    'fieldPath: "appointmentAt" }, direction: "ASCENDING"',
    "limit: 200",
    "timestampValue: earliest.toISOString()",
    "stringValue: earliest.toISOString()"
  ]) assert.ok(source.includes(fragment), `Worker missing ${fragment}`);
  for (const fragment of [
    'collectionId: "matches", allDescendants: true',
    'fieldPath: "appointmentAt" }, op: "GREATER_THAN"',
    'fieldPath: "appointmentAt" }, op: "LESS_THAN_OR_EQUAL"',
    'fieldPath: "appointmentAt" }, direction: "ASCENDING"',
    "limit: 200",
    '"timestamp"',
    '"legacy-string"'
  ]) assert.ok(diagnostic.includes(fragment), `Diagnostic missing ${fragment}`);
});

test("isolated confirmed fixture produces ten minute reminder without sending it", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const due = dueViewingReminders({
    appointmentAt: "2026-10-17T12:09:00.000Z",
    appointmentStatus: "CONFIRMED_BY_BROKER",
    livingStage: "APPOINTMENT_CONFIRMED"
  }, now, 10);
  assert.deepEqual(due.map((entry) => entry.kind), [VIEWING_REMINDER_KIND.TEN_MINUTES]);
  assert.match(diagnostic, /notificationsAttempted: false/);
  assert.match(diagnostic, /externalMessagesSent: false/);
  assert.match(diagnostic, /admin\.initializeApp\(\{ credential: admin\.cert\(serviceAccount\)/);
  assert.match(diagnostic, /getFirestore\(app\)/);
  assert.match(diagnostic, /Timestamp\.fromDate\(appointmentAt\)/);
  assert.doesNotMatch(diagnostic, /admin\.credential|admin\.apps|admin\.firestore\(/);
});
