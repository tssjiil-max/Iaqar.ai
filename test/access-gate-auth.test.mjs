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

test("access-gate sets LOCAL persistence before sign-in", () => {
  const loginBlock = accessGate.slice(
    accessGate.indexOf('gate.querySelector("#loginForm").onsubmit'),
    accessGate.indexOf("function forgotPasswordForm")
  );
  const persistenceIdx = loginBlock.indexOf("setPersistence");
  const signInIdx = loginBlock.indexOf("signInWithEmailAndPassword");
  assert.ok(persistenceIdx > 0 && signInIdx > persistenceIdx);
  assert.ok(loginBlock.includes("Auth.Persistence.LOCAL"));
});

test("access-gate exposes extended auth diagnostic events", () => {
  const extended = [
    "AUTH_READY",
    "SIGN_IN_SUCCESS",
    "USER_FOUND",
    "OFFICE_LOADING",
    "OFFICE_FOUND",
    "REDIRECT_REASON",
    "SIGN_OUT_CALL"
  ];
  for (const event of extended) {
    assert.ok(accessGate.includes(event), `missing diagnostic event ${event}`);
  }
});

test("access-gate registers single auth listener with unsubscribe", () => {
  assert.ok(accessGate.includes("authStateUnsubscribe"));
  assert.ok(accessGate.includes("onAuthStateChanged(handleAuthStateChanged)"));
  assert.ok(accessGate.includes("authStateUnsubscribe()"));
  assert.ok(accessGate.includes("granted_without_explicit_sign_out"));
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

test("access-gate login uses soft office unlock without mandatory full reload", () => {
  assert.ok(accessGate.includes("function unlockOfficeWorkspace"));
  assert.ok(accessGate.includes("rebindOfficeContext"));
  assert.ok(accessGate.includes("iaqar:access-granted"));
  const loginBlock = accessGate.slice(
    accessGate.indexOf('gate.querySelector("#loginForm").onsubmit'),
    accessGate.indexOf("function forgotPasswordForm")
  );
  assert.ok(loginBlock.includes("getIdToken(false)"));
  assert.equal(loginBlock.includes("getIdToken(true)"), false);
});

test("access-gate login submit is guarded and shows Arabic loading label", () => {
  assert.ok(accessGate.includes("loginSubmitInFlight"));
  assert.ok(accessGate.includes("جارٍ تسجيل الدخول…"));
});

test("access-gate exposes login performance tracing in development", () => {
  assert.ok(accessGate.includes("LOGIN_PERF_ENABLED"));
  assert.ok(accessGate.includes("loginPerfMark"));
  assert.ok(accessGate.includes("[iaqar-login-perf]"));
});

test("access-gate brand header uses compact proportional sizing", () => {
  assert.ok(accessGate.includes(".access-brand img{width:52px;height:52px"));
  assert.ok(accessGate.includes(".access-brand h1{margin:4px 0 2px;color:#087064;font-size:17px"));
  assert.ok(accessGate.includes("@media (max-width:320px)"));
});

test("access-gate short-circuits cv2Party before creating the role chooser", () => {
  const partyIdx = accessGate.indexOf('URLSearchParams(location.search).get("cv2Party")');
  const lockIdx = accessGate.indexOf('document.body.classList.add("access-locked")');
  const gateIdx = accessGate.indexOf('gate.id = "accessGate"');
  const chooserIdx = accessGate.indexOf("لدي عقار");
  assert.ok(partyIdx > 0 && partyIdx < lockIdx, "cv2Party must be inspected before access-locked");
  assert.ok(partyIdx < gateIdx, "cv2Party must be inspected before #accessGate");
  assert.ok(partyIdx < chooserIdx, "cv2Party must be inspected before role chooser");
  const prelude = accessGate.slice(0, lockIdx);
  assert.ok(accessGate.includes("ACCESS_GATE_SKIPPED"));
  assert.ok(accessGate.includes("ACCESS_GATE_RENDERED"));
});

test("firebase-office exposes office rebind for post-login context switch", () => {
  const officeJs = read("public", "js", "firebase-office.js");
  assert.ok(officeJs.includes("function rebindOfficeContext"));
  assert.ok(officeJs.includes("iaqar:office-rebound"));
});
