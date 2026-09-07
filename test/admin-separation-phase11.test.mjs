import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLATFORM_ADMIN_CLAIM,
  isPlatformAdminClaims,
  assertPlatformAdminClaims,
  adminControlPlaneBoundaryGuarantees
} from "../worker/src/admin-control-plane-domain.js";

function readRepo(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("platform admin requires the dedicated platformAdmin claim", () => {
  assert.equal(PLATFORM_ADMIN_CLAIM, "platformAdmin");
  assert.equal(isPlatformAdminClaims({ platformAdmin: true }), true);
  assert.equal(isPlatformAdminClaims({ admin: true }), false);
  assert.equal(isPlatformAdminClaims({ role: "admin" }), false);
  assert.equal(assertPlatformAdminClaims({ admin: true }).ok, false);
  assert.equal(assertPlatformAdminClaims({ platformAdmin: true, sub: "u1" }).ok, true);
});

test("admin control plane is server-authoritative and separate from office workflow", () => {
  const guarantees = adminControlPlaneBoundaryGuarantees();
  assert.equal(guarantees.acceptsLegacyAdminClaim, false);
  assert.equal(guarantees.browserClaimIsAuthoritative, false);
  assert.equal(guarantees.serverSessionRequired, true);
  assert.equal(guarantees.officeRoleCanGrantPlatformAdmin, false);
  assert.equal(guarantees.namespacedAdminRoutes, true);
  assert.equal(guarantees.ownsOfficeBusinessWorkflow, false);
});

test("worker uses strict admin claim boundary and exposes an admin session endpoint", () => {
  const index = readRepo("worker/src/index.js");
  assert.match(index, /assertPlatformAdminClaims/);
  assert.match(index, /url\.pathname === "\/admin\/session"/);
  assert.doesNotMatch(index, /claims\.platformAdmin !== true && claims\.admin !== true/);
});

test("admin service provides a server-verified session without office workflow mutation", () => {
  const service = readRepo("worker/src/admin-service.js");
  assert.match(service, /export async function handleAdminSession/);
  assert.match(service, /requirePlatformIdentity\(request, env, true\)/);
  const sessionSection = service.slice(service.indexOf("export async function handleAdminSession"), service.indexOf("export async function handleAdminOverview"));
  assert.doesNotMatch(sessionSection, /setFirestoreDocument/);
  assert.doesNotMatch(sessionSection, /operations|matches|deals|opportunities/);
});

test("admin browser asks the Worker for session authorization instead of trusting token claims", () => {
  const api = readRepo("public/js/admin-api.js");
  const consoleSource = readRepo("public/js/admin-console.js");
  assert.match(api, /session\(\) \{ return this\.request\("\/admin\/session"\); \}/);
  assert.match(consoleSource, /await api\.session\(\)/);
  assert.doesNotMatch(consoleSource, /getIdTokenResult/);
  assert.doesNotMatch(consoleSource, /claims\.admin/);
});

test("platform admin UI stays isolated from the office application shell", () => {
  const adminHtml = readRepo("public/admin/index.html");
  const officeHtml = readRepo("public/index.html");
  assert.match(adminHtml, /\/js\/admin-console\.js/);
  assert.doesNotMatch(officeHtml, /\/js\/admin-console\.js/);
  assert.doesNotMatch(officeHtml, /id="adminUserLine"/);
});
