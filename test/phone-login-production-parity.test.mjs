import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import worker from "../worker/src/index.js";
import * as workerOfficeId from "../worker/src/office-id-domain.js";
import * as publicOfficeId from "../public/js/office-id-domain.js";

// Regression guard: the active Production Worker (450d767f) carries three
// auth-related changes that were deployed from a local tree and never pushed.
// A release built from this branch must keep them:
//   1. a Worker-local office-id-domain module imported by index.js,
//   2. /auth/phone-login-lookup and /auth/login-resolve as aliases of
//      /auth/phone-login-resolve,
//   3. /auth/phone-login returning officeId normalized by firestoreOfficeId().

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const RAW_OFFICE_ID = " Office Alqiq.Riyadh ";
const NORMALIZED_OFFICE_ID = "Office-Alqiq-Riyadh";
const UID = "uid-parity-1";
const EMAIL = "Parity.Office@Example.Test";

const env = {
  FIREBASE_PROJECT_ID: "demo-iaqar",
  FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@demo-iaqar.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_PRIVATE_KEY_ID: "0123456789abcdef0123456789abcdef01234567",
  FIREBASE_WEB_API_KEY: "test-web-api-key"
};

function directoryFields() {
  return {
    uid: { stringValue: UID },
    officeId: { stringValue: RAW_OFFICE_ID },
    email: { stringValue: EMAIL },
    active: { booleanValue: true }
  };
}

async function withFirebaseDouble(run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ url, method });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "test-access-token", expires_in: 3600 });
    }
    if (url.includes("identitytoolkit.googleapis.com") && url.includes("signInWithPassword")) {
      return Response.json({ localId: UID, idToken: "id-token" });
    }
    if (method === "GET" && url.includes("/documents/loginDirectory/")) {
      return Response.json({ name: url, fields: directoryFields() });
    }
    if (method === "GET" && url.includes("/documents/loginRateLimits/")) {
      return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    }
    return Response.json({});
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function post(path, body) {
  const response = await worker.fetch(new Request(`https://worker.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body)
  }), env);
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

for (const path of ["/auth/phone-login-resolve", "/auth/phone-login-lookup", "/auth/login-resolve"]) {
  test(`${path} resolves the login directory (Production parity)`, async () => {
    await withFirebaseDouble(async () => {
      const { status, json } = await post(path, { phone: "0551234567" });
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.ok, true);
      assert.equal(json.loginEmail, EMAIL.toLowerCase());
      assert.equal(json.officeId, NORMALIZED_OFFICE_ID);
    });
  });
}

test("login resolve aliases reject an invalid phone exactly like the canonical route", async () => {
  await withFirebaseDouble(async () => {
    for (const path of ["/auth/phone-login-resolve", "/auth/phone-login-lookup", "/auth/login-resolve"]) {
      const { status, json } = await post(path, { phone: "12" });
      assert.equal(status, 401, path);
      assert.equal(json.reason, "invalid_input", path);
    }
  });
});

test("/auth/phone-login returns officeId normalized by firestoreOfficeId", async () => {
  await withFirebaseDouble(async (calls) => {
    const { status, json } = await post("/auth/phone-login", {
      phone: "0551234567",
      password: "correct-horse-battery"
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(typeof json.customToken, "string");
    assert.ok(json.customToken.split(".").length === 3);
    assert.equal(json.officeId, NORMALIZED_OFFICE_ID);
    assert.notEqual(json.officeId, RAW_OFFICE_ID);
    assert.ok(calls.some((call) => call.url.includes("signInWithPassword")));
  });
});

test("/auth/phone-login and /auth/phone-login-resolve agree on officeId", async () => {
  await withFirebaseDouble(async () => {
    const resolved = await post("/auth/phone-login-resolve", { phone: "0551234567" });
    const loggedIn = await post("/auth/phone-login", { phone: "0551234567", password: "correct-horse-battery" });
    assert.equal(resolved.json.officeId, loggedIn.json.officeId);
  });
});

test("Worker imports office-id helpers from its local module", () => {
  const source = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/office-id-domain\.js";/);
  assert.doesNotMatch(source, /from "\.\.\/\.\.\/public\/js\/office-id-domain\.js";/);
});

test("Worker-local office-id module behaves exactly like the shared one", () => {
  const samples = ["", null, undefined, "office-1", " Office Alqiq.Riyadh ", "OFFICE_ABC", "مكتب-الرياض", "a--b__c", "-x-", "x".repeat(120)];
  for (const value of samples) {
    assert.equal(workerOfficeId.text(value), publicOfficeId.text(value));
    assert.equal(workerOfficeId.firestoreOfficeId(value), publicOfficeId.firestoreOfficeId(value));
    assert.equal(workerOfficeId.officeAuthorizationKey(value), publicOfficeId.officeAuthorizationKey(value));
  }
  assert.equal(workerOfficeId.officeIdsEquivalent("Office-1", "office 1"), publicOfficeId.officeIdsEquivalent("Office-1", "office 1"));
  assert.equal(workerOfficeId.officeIdsEquivalent("", ""), false);
});
