import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const env = { FIREBASE_PROJECT_ID: "aqar-b5d76" };

const ADMIN_ROUTES = [
  { method: "GET", path: "/admin/overview" },
  { method: "GET", path: "/admin/applications" },
  { method: "GET", path: "/admin/offices" },
  { method: "GET", path: "/admin/office?officeId=office-a" },
  { method: "GET", path: "/admin/office/activity?officeId=office-a" },
  { method: "GET", path: "/admin/audit-log" },
  { method: "GET", path: "/admin/broker-applications" },
  { method: "POST", path: "/admin/broker-applications/action", body: { applicationId: "app-1", action: "reject" } },
  { method: "POST", path: "/admin/office/suspend", body: { officeId: "office-a", reason: "test reason" } },
  { method: "POST", path: "/admin/office/reactivate", body: { officeId: "office-a" } }
];

for (const route of ADMIN_ROUTES) {
  test(`admin route ${route.method} ${route.path} rejects unauthenticated access`, async () => {
    const response = await worker.fetch(new Request(`https://example.test${route.path}`, {
      method: route.method,
      headers: { "Content-Type": "application/json" },
      body: route.body ? JSON.stringify(route.body) : undefined
    }), env);
    assert.notEqual(response.status, 200);
    const payload = await response.json();
    assert.ok(
      ["auth_required", "firebase_not_configured", "admin_required"].includes(payload.error),
      `expected auth failure, got ${payload.error}`
    );
  });
}

test("worker enforces platformAdmin claim in requirePlatformIdentity", () => {
  const source = readRepositoryFile("worker", "src", "index.js");
  assert.match(source, /claims\.platformAdmin !== true && claims\.admin !== true/);
  assert.match(source, /appError\("admin_required", 403/);
});

test("firestore rules deny brokerApplications writes to non-admins", () => {
  const rules = readRepositoryFile("firestore.rules");
  const block = rules.slice(rules.indexOf("match /brokerApplications/{applicationId}"));
  assert.match(block, /allow create: if false/);
  assert.match(block, /allow read, update, delete: if isPlatformAdmin\(\)/);
});

test("firestore rules make adminAuditLogs immutable to clients", () => {
  const rules = readRepositoryFile("firestore.rules");
  const block = rules.slice(rules.indexOf("match /adminAuditLogs/{auditId}"));
  assert.match(block, /allow read: if isPlatformAdmin\(\)/);
  assert.match(block, /allow create, update, delete: if false/);
});

test("office create is restricted to platform admins in firestore rules", () => {
  const rules = readRepositoryFile("firestore.rules");
  const block = rules.slice(rules.indexOf("match /offices/{officeId}"));
  assert.match(block, /allow create: if isPlatformAdmin\(\)/);
});

test("broker application action supports under_review lifecycle", () => {
  const source = readRepositoryFile("worker", "src", "index.js");
  assert.match(source, /\["approve", "reject", "under_review"\]/);
  assert.match(source, /application_under_review/);
});
