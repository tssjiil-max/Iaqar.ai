import test from "node:test";
import assert from "node:assert/strict";
import worker, { firestoreFieldsToJs, isNotificationTypeEnabled, notificationPreferenceKey, sendOfficePush } from "../src/index.js";

// بيئة تجريبية: مكتب تجريبي بلا توثيق حتى تُختبر مسارات الوسائط دون أسرار حقيقية.
const trialEnv = {
  FIREBASE_PROJECT_ID: "aqar-b5d76",
  META_TRIAL_OFFICE_ID: "office-trial",
  ALLOW_TRIAL_NO_AUTH: "true"
};

function mediaEnv(overrides = {}) {
  const writes = [];
  const deletes = [];
  const bucket = {
    put: async (...args) => writes.push(args),
    delete: async key => deletes.push(key),
    get: async () => null,
    ...overrides
  };
  return { env: { ...trialEnv, IAQAR_MEDIA: bucket }, writes, deletes };
}

test("phase 1: office logo upload stores a fixed per-office key and returns logoUrl", async () => {
  const { env, writes } = mediaEnv();
  const response = await worker.fetch(new Request("https://example.test/media/office-logo", {
    method: "POST",
    headers: { "Content-Type": "image/png", "Content-Length": "4", "X-Office-Id": "office-trial" },
    body: new Uint8Array([1, 2, 3, 4])
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.ok(body.logoUrl.includes("/media/public/office-logos/office-trial/logo"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "office-logos/office-trial/logo");
});

test("phase 1: office logo upload rejects unsupported types and oversized files", async () => {
  const { env } = mediaEnv();
  const badType = await worker.fetch(new Request("https://example.test/media/office-logo", {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "Content-Length": "4", "X-Office-Id": "office-trial" },
    body: new Uint8Array([1, 2, 3, 4])
  }), env);
  assert.equal(badType.status, 415);

  const tooLarge = await worker.fetch(new Request("https://example.test/media/office-logo", {
    method: "POST",
    headers: { "Content-Type": "image/png", "Content-Length": String(6 * 1024 * 1024), "X-Office-Id": "office-trial" },
    body: new Uint8Array([1, 2, 3, 4])
  }), env);
  assert.equal(tooLarge.status, 413);
});

test("phase 1: office media endpoints require authentication for non-trial offices", async () => {
  const { env } = mediaEnv();
  for (const path of ["/media/office-logo", "/media/office-cover", "/media/office-logo/delete", "/media/office-cover/delete"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": "4", "X-Office-Id": "office-a" },
      body: new Uint8Array([1, 2, 3, 4])
    }), env);
    assert.equal(response.status, 401, `${path} must demand authentication`);
  }
});

test("phase 1: office cover/logo removal deletes the exact per-office key", async () => {
  const { env, deletes } = mediaEnv();
  const response = await worker.fetch(new Request("https://example.test/media/office-cover/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "2", "X-Office-Id": "office-trial" },
    body: "{}"
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(deletes, ["office-covers/office-trial/cover"]);
});

test("phase 1: public office asset serving allows only cover/logo keys", async () => {
  const served = { body: "img-bytes", httpEtag: '"etag-1"', writeHttpMetadata(headers) { headers.set("content-type", "image/jpeg"); } };
  const { env } = mediaEnv({ get: async key => key === "office-logos/office-a/logo" ? served : null });

  const ok = await worker.fetch(new Request("https://example.test/media/public/office-logos/office-a/logo"), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("etag"), '"etag-1"');

  const traversal = await worker.fetch(new Request("https://example.test/media/public/office-logos/office-a/logo%2F..%2Fsecret"), env);
  assert.equal(traversal.status, 404);

  const otherPrefix = await worker.fetch(new Request("https://example.test/media/public/office-logos/office-a/cover"), env);
  assert.equal(otherPrefix.status, 404);
});

test("phase 1: notification preference mapping follows the approved categories", () => {
  assert.equal(notificationPreferenceKey("match"), "matches");
  assert.equal(notificationPreferenceKey("client_request"), "ownerCustomer");
  assert.equal(notificationPreferenceKey("owner_offer"), "ownerCustomer");
  assert.equal(notificationPreferenceKey("cooperation_request"), "cooperation");
  assert.equal(notificationPreferenceKey("follow_up"), "appointments");
  assert.equal(notificationPreferenceKey("broker_application"), "system");
});

test("phase 1: notification preferences gate pushes with safe defaults", () => {
  assert.equal(isNotificationTypeEnabled(undefined, "match"), true, "missing preferences default to enabled");
  assert.equal(isNotificationTypeEnabled({ matches: false }, "match"), false, "disabled category blocks the push");
  assert.equal(isNotificationTypeEnabled({ matches: false }, "notification_test"), true, "explicit activation test always passes");
  assert.equal(isNotificationTypeEnabled({ appointments: false }, "match", "appointments"), false, "preference key override wins");
  assert.equal(isNotificationTypeEnabled({ matches: false }, "totally_unknown"), true, "unknown types are not silently dropped");
});

test("phase 1: Firestore field decoding supports maps and arrays", () => {
  const decoded = firestoreFieldsToJs({
    officeName: { stringValue: "مكتب المسار" },
    notificationPreferences: { mapValue: { fields: {
      matches: { booleanValue: false },
      system: { booleanValue: true }
    } } },
    specialties: { arrayValue: { values: [{ stringValue: "sale" }, { stringValue: "rent" }] } },
    emptyList: { arrayValue: {} },
    nothing: { nullValue: null }
  });
  assert.equal(decoded.officeName, "مكتب المسار");
  assert.deepEqual(decoded.notificationPreferences, { matches: false, system: true });
  assert.deepEqual(decoded.specialties, ["sale", "rent"]);
  assert.deepEqual(decoded.emptyList, []);
  assert.equal(decoded.nothing, null);
});

test("phase 1: sendOfficePush skips delivery when the office disabled the category", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    // أول نداء: قراءة مستند المكتب وتفضيلاته.
    return Response.json({ fields: { notificationPreferences: { mapValue: { fields: { matches: { booleanValue: false } } } } } });
  };
  try {
    const summary = await sendOfficePush({
      projectId: "aqar-b5d76", officeId: "office-a",
      title: "مطابقة", body: "جديدة", type: "match", recordId: "mat_1", accessToken: "token"
    });
    assert.equal(summary.skipped, true);
    assert.equal(summary.sent, 0);
    assert.equal(calls.length, 1, "no device listing and no FCM call after the preference gate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
