import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

const accessGate = read("public", "js", "access-gate.js");
const worker = read("worker", "src", "index.js");

const DIAG_EVENTS = [
  "AUTH_LOGIN_SUCCESS",
  "AUTH_STATE_CHANGED",
  "AUTH_UID",
  "AUTH_EMAIL",
  "AUTH_PERSISTENCE",
  "PROFILE_LOOKUP_START",
  "PROFILE_LOOKUP_RESULT",
  "OFFICE_ID_RESULT",
  "ROLE_RESULT",
  "ACCOUNT_STATUS_RESULT",
  "AUTH_GUARD_DECISION",
  "SIGNOUT_CALL_SOURCE",
  "LOGIN_REDIRECT_SOURCE"
];

test("access-gate exposes required auth diagnostic events", () => {
  for (const event of DIAG_EVENTS) {
    assert.ok(accessGate.includes(event), `missing diagnostic event ${event}`);
  }
});

test("access-gate uses browser email/password login via phone-login-resolve", () => {
  assert.ok(accessGate.includes("/auth/phone-login-resolve"));
  assert.ok(accessGate.includes("signInWithEmailAndPassword"));
  assert.equal(accessGate.includes("signInWithCustomToken"), false);
});

test("access-gate auth guard distinguishes loading from unauthenticated", () => {
  assert.ok(accessGate.includes('authGuardState = "loading"'));
  assert.ok(accessGate.includes("authStateReady"));
  assert.ok(accessGate.includes('decision: "ignore_auth_change"'));
  assert.ok(accessGate.includes("accessVerificationInFlight"));
});

test("access-gate verifyAccess returns boolean grant result", () => {
  assert.ok(accessGate.includes("async function verifyAccess"));
  assert.ok(accessGate.includes("return true"));
  assert.ok(accessGate.includes("return false"));
  assert.ok(accessGate.includes("offices/${target}/members/${user.uid}"));
});

test("access-gate sets persistence before sign-in and respects remember me", () => {
  const loginBlock = accessGate.slice(
    accessGate.indexOf('gate.querySelector("#loginForm").onsubmit'),
    accessGate.indexOf("function forgotPasswordForm")
  );
  const persistenceIdx = loginBlock.indexOf("setPersistence");
  const signInIdx = loginBlock.indexOf("signInWithEmailAndPassword");
  assert.ok(persistenceIdx > 0 && signInIdx > persistenceIdx);
  assert.ok(loginBlock.includes("Auth.Persistence.LOCAL"));
  assert.ok(loginBlock.includes("Auth.Persistence.SESSION"));
});

test("access-gate routes signOut through diagnostic wrapper", () => {
  assert.ok(accessGate.includes("async function authSignOut"));
  assert.ok(accessGate.includes("SIGNOUT_CALL_SOURCE"));
  assert.ok((accessGate.match(/await authSignOut\(/g) || []).length >= 4);
  assert.equal((accessGate.match(/firebase\.auth\(\)\.signOut\(\)/g) || []).length, 1);
});

test("worker exposes phone-login-resolve endpoint", () => {
  assert.ok(worker.includes('"/auth/phone-login-resolve"'));
  assert.ok(worker.includes("handlePhoneLoginResolve"));
  assert.ok(worker.includes("lookupActivePhoneLoginDirectory"));
});

test("access-gate staging worker fallback includes iaqar-ai-staging host", () => {
  assert.ok(accessGate.includes('host.includes("iaqar-ai-staging")'));
});
