import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import worker, {
  ALWAYS_ALLOWED_PUSH_TYPES,
  PUSH_TYPE_NOTIFICATION_CATEGORIES,
  MATCHING_RULE_VERSION,
  MATCH_THRESHOLD,
  buildMatchId,
  buildNotificationLink,
  buildFcmTarget,
  buildFcmHttpMessage,
  canonicalPairKey,
  createServiceAccountJwt,
  firebaseServiceAccount,
  legacyLocalLoginPhone,
  normalizeLoginPhone,
  normalizeOfficeImageVariant,
  normalizeOpportunitySourceType,
  notificationCategoryAllowed,
  notificationCategoryForPushType,
  parseFcmFailure,
  phase4BoundaryGuarantees,
  phase6BoundaryGuarantees,
  phase7BoundaryGuarantees,
  relevantDataVersion,
  resolveLoginDirectory,
  scoreMatch
} from "../src/index.js";

const env = { FIREBASE_PROJECT_ID: "aqar-b5d76", META_TRIAL_OFFICE_ID: "office-alqiq" };

test("FCM targets use FID first with a legacy token fallback", () => {
  assert.deepEqual(buildFcmTarget("fid-123", "fid"), { fid: "fid-123" });
  assert.deepEqual(buildFcmTarget("token-123", "token"), { token: "token-123" });
});

test("FCM HTTP v1 web payload uses an HTTPS deep link and REST fcm_options field", () => {
  const payload = buildFcmHttpMessage({
    registrationId: "fid-123", registrationType: "fid", title: "مطابقة", body: "فرصة جديدة",
    type: "match", recordId: "match-9", officeId: "office-1", deliveryId: "delivery-1"
  });
  assert.equal(payload.message.fid, "fid-123");
  assert.equal(payload.message.data.url, "https://iaqar.ai/?officeId=office-1&openMatch=match-9");
  assert.deepEqual(payload.message.webpush.fcm_options, { link: payload.message.data.url });
  assert.equal("fcmOptions" in payload.message.webpush, false);
});

test("Firebase service account secrets ignore PowerShell line endings", () => {
  const credentials = firebaseServiceAccount({
    FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@example.test\r\n",
    FIREBASE_PRIVATE_KEY: "\r\n-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\r\n",
    FIREBASE_PRIVATE_KEY_ID: " key-123\r\n"
  });
  assert.equal(credentials.clientEmail, "firebase-adminsdk@example.test");
  assert.equal(credentials.privateKey, "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----");
  assert.equal(credentials.privateKeyId, "key-123");
});

test("Firebase service account JWT identifies the exact private key", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const jwt = await createServiceAccountJwt({
    clientEmail: "firebase-adminsdk@example.test",
    privateKey,
    privateKeyId: "firebase-key-123",
    nowSeconds: 1_800_000_000
  });
  const header = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "RS256", typ: "JWT", kid: "firebase-key-123" });
});

test("office login normalizes every Saudi mobile format to one canonical value", () => {
  assert.equal(normalizeLoginPhone("0551234567"), "+966551234567");
  assert.equal(normalizeLoginPhone("966551234567"), "+966551234567");
  assert.equal(normalizeLoginPhone("+966 55 123 4567"), "+966551234567");
});

test("office login derives the legacy local value for old directory records", () => {
  assert.equal(legacyLocalLoginPhone("+966551234567"), "0551234567");
});

test("office login falls back to a legacy directory record and creates the canonical record", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || "GET" });
    if (calls.length === 1) return new Response("", { status: 404 });
    if (calls.length === 2) return Response.json({ fields: {
      uid: { stringValue: "user-1" }, officeId: { stringValue: "office-1" },
      email: { stringValue: "office@example.test" }, active: { booleanValue: true }
    }});
    return Response.json({ fields: {} });
  };
  try {
    const result = await resolveLoginDirectory({
      projectId: "aqar-b5d76", phone: "+966551234567", accessToken: "test-token"
    });
    assert.equal(result.migratedLegacy, true);
    assert.ok(result.directoryDoc);
    assert.deepEqual(calls.map(call => call.method), ["GET", "GET", "PATCH"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("health is inbound-only", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.outboundMessaging, false);
  assert.equal(body.mode, "inbound-only");
  assert.equal(body.deploymentEnvironment, "production");
  assert.equal(body.firebaseConfigured, false);
  assert.equal(body.backendReady, false);
  assert.equal(body.cronEnabled, true);
});

test("health reports staging when DEPLOYMENT_ENV=staging", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/health"),
    { ...env, DEPLOYMENT_ENV: "staging" }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.deploymentEnvironment, "staging");
  assert.equal(body.outboundMessaging, false);
  assert.equal(body.cronEnabled, false);
  assert.equal(body.backendReady, false);
});

test("health backendReady is true when Firebase secrets exist", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/health"),
    {
      ...env,
      DEPLOYMENT_ENV: "staging",
      FIREBASE_CLIENT_EMAIL: "sa@example.test",
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n"
    }
  );
  const body = await response.json();
  assert.equal(body.firebaseConfigured, true);
  assert.equal(body.backendReady, true);
  assert.equal(body.cronEnabled, false);
});

test("Meta config is disabled until credentials exist", async () => {
  const response = await worker.fetch(new Request("https://example.test/meta/config?officeId=office-alqiq"), env);
  const body = await response.json();
  assert.equal(body.enabled, false);
  assert.equal(body.trialAllowed, true);
});

test("legacy MacroDroid endpoint is disabled", async () => {
  const response = await worker.fetch(new Request("https://example.test/ingest", { method: "POST" }), env);
  assert.equal(response.status, 410);
});

test("outbound message routes are blocked", async () => {
  const response = await worker.fetch(new Request("https://example.test/meta/messages", { method: "POST" }), env);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "outbound_disabled");
});

test("webhook verification rejects a wrong token", async () => {
  const secureEnv = { ...env, META_WEBHOOK_VERIFY_TOKEN: "correct" };
  const response = await worker.fetch(new Request("https://example.test/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"), secureEnv);
  assert.equal(response.status, 403);
});

test("public intake media is written to the R2 bucket with a private key", async () => {
  const writes = [];
  const mediaEnv = { ...env, IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
  const response = await worker.fetch(new Request("https://example.test/media/public-intake", {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg", "Content-Length": "4",
      "X-Office-Id": "platform", "X-Intake-Id": "request_123456",
      "X-Media-Kind": "image", "X-Media-Index": "1"
    },
    body: new Uint8Array([1, 2, 3, 4])
  }), mediaEnv);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.mediaPath, "public-intake/platform/request_123456/image-1.jpg");
  assert.equal(writes.length, 1);
});

test("public intake media rejects an unsupported content type", async () => {
  const mediaEnv = { ...env, IAQAR_MEDIA: { put: async () => {} } };
  const response = await worker.fetch(new Request("https://example.test/media/public-intake", {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf", "Content-Length": "4",
      "X-Office-Id": "platform", "X-Intake-Id": "request_123456",
      "X-Media-Kind": "image", "X-Media-Index": "1"
    },
    body: new Uint8Array([1, 2, 3, 4])
  }), mediaEnv);
  assert.equal(response.status, 415);
});

// --- Phase 1: office visual identity ---------------------------------------

const trialEnv = { ...env, ALLOW_TRIAL_NO_AUTH: "true" };

function officeImageRequest({ variant, method = "POST", contentType = "image/png", officeId = "office-alqiq" } = {}) {
  const headers = { "X-Office-Id": officeId };
  if (variant !== undefined) headers["X-Office-Image-Variant"] = variant;
  if (method === "POST") {
    headers["Content-Type"] = contentType;
    headers["Content-Length"] = "4";
  }
  return new Request("https://example.test/media/office-cover", {
    method,
    headers,
    body: method === "POST" ? new Uint8Array([1, 2, 3, 4]) : undefined
  });
}

test("each office image variant is stored under its own key and returns its URL", async () => {
  for (const variant of ["logo", "display", "cover"]) {
    const writes = [];
    const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
    const response = await worker.fetch(officeImageRequest({ variant }), mediaEnv);
    const body = await response.json();
    assert.equal(response.status, 201, `${variant}: ${JSON.stringify(body)}`);
    assert.equal(body.variant, variant);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], `office-covers/office-alqiq/${variant}`);
    assert.equal(writes[0][2].customMetadata.variant, variant);
    assert.ok(body.imageUrl.includes(`/media/public/office-covers/office-alqiq/${variant}?v=`));
    // The old field name stays populated so any older client keeps working.
    assert.equal(body.coverUrl, body.imageUrl);
  }
});

test("an office image upload without a variant defaults to the cover, as before", async () => {
  const writes = [];
  const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
  const response = await worker.fetch(officeImageRequest({ variant: undefined }), mediaEnv);
  assert.equal(response.status, 201);
  assert.equal(writes[0][0], "office-covers/office-alqiq/cover");
});

test("an unknown office image variant is refused instead of writing an unexpected key", async () => {
  for (const variant of ["private", "../cover", "COVER2", "intake"]) {
    const writes = [];
    const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
    const response = await worker.fetch(officeImageRequest({ variant }), mediaEnv);
    assert.equal(response.status, 400, variant);
    const body = await response.json();
    assert.equal(body.error, "unsupported_image_variant");
    assert.equal(writes.length, 0, `${variant} must not reach the bucket`);
  }
});

test("office image variants are case-insensitive", async () => {
  const writes = [];
  const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
  const response = await worker.fetch(officeImageRequest({ variant: "LOGO" }), mediaEnv);
  assert.equal(response.status, 201);
  assert.equal(writes[0][0], "office-covers/office-alqiq/logo");
});

test("office image uploads still enforce type and size server-side", async () => {
  const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { put: async () => {} } };
  const badType = await worker.fetch(officeImageRequest({ variant: "logo", contentType: "image/gif" }), mediaEnv);
  assert.equal(badType.status, 415);

  const tooLarge = await worker.fetch(new Request("https://example.test/media/office-cover", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(11 * 1024 * 1024),
      "X-Office-Id": "office-alqiq",
      "X-Office-Image-Variant": "logo"
    },
    body: new Uint8Array([1, 2, 3, 4])
  }), mediaEnv);
  assert.equal(tooLarge.status, 413);
});

test("an office image upload requires an office id", async () => {
  const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { put: async () => {} } };
  const response = await worker.fetch(new Request("https://example.test/media/office-cover", {
    method: "POST",
    headers: { "Content-Type": "image/png", "Content-Length": "4", "X-Office-Image-Variant": "logo" },
    body: new Uint8Array([1, 2, 3, 4])
  }), mediaEnv);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "office_id_required");
});

test("an office image upload from an unauthorized caller is refused", async () => {
  const writes = [];
  const mediaEnv = { ...env, IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
  const response = await worker.fetch(officeImageRequest({ variant: "logo" }), mediaEnv);
  assert.equal(response.status, 401);
  assert.equal(writes.length, 0);
});

test("a removable office image is deleted from its own key", async () => {
  for (const variant of ["logo", "display"]) {
    const deletes = [];
    const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { delete: async key => deletes.push(key) } };
    const response = await worker.fetch(officeImageRequest({ variant, method: "DELETE" }), mediaEnv);
    const body = await response.json();
    assert.equal(response.status, 200, `${variant}: ${JSON.stringify(body)}`);
    assert.equal(body.removed, true);
    assert.deepEqual(deletes, [`office-covers/office-alqiq/${variant}`]);
  }
});

test("the share cover cannot be deleted, and the refusal is explicit", async () => {
  const deletes = [];
  const mediaEnv = { ...trialEnv, IAQAR_MEDIA: { delete: async key => deletes.push(key) } };
  const response = await worker.fetch(officeImageRequest({ variant: "cover", method: "DELETE" }), mediaEnv);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "image_not_removable");
  assert.deepEqual(deletes, [], "nothing may be deleted when the request is refused");
});

test("the public media route serves every office image variant", async () => {
  for (const variant of ["cover", "logo", "display"]) {
    const mediaEnv = {
      ...env,
      IAQAR_MEDIA: {
        get: async () => ({
          body: "binary",
          httpEtag: '"etag"',
          writeHttpMetadata(headers) { headers.set("content-type", "image/png"); }
        })
      }
    };
    const response = await worker.fetch(
      new Request(`https://example.test/media/public/office-covers/office-alqiq/${variant}`),
      mediaEnv
    );
    assert.equal(response.status, 200, variant);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

test("office image variant normalization mirrors the client's variant list", () => {
  assert.equal(normalizeOfficeImageVariant("logo"), "logo");
  assert.equal(normalizeOfficeImageVariant(" DISPLAY "), "display");
  assert.equal(normalizeOfficeImageVariant(""), "cover", "an absent variant means the cover");
  assert.equal(normalizeOfficeImageVariant(null), "cover");
  for (const value of ["private", "thumb", "../cover", "logo2"]) {
    assert.equal(normalizeOfficeImageVariant(value), "", value);
  }
});

// --- Phase 1: notification preference gate ---------------------------------

test("a disabled notification category blocks only its own push types", () => {
  const preferences = { matchNotifications: false, cooperationNotifications: false };
  assert.equal(notificationCategoryAllowed("match", preferences), false);
  assert.equal(notificationCategoryAllowed("deal", preferences), false);
  assert.equal(notificationCategoryAllowed("cooperation_request", preferences), false);
  assert.equal(notificationCategoryAllowed("appointment", preferences), true);
  assert.equal(notificationCategoryAllowed("owner_offer", preferences), true);
});

test("a missing preference document leaves every notification enabled", () => {
  for (const preferences of [undefined, null, {}, { officeId: "office-alqiq", updatedBy: "uid" }]) {
    for (const type of Object.keys(PUSH_TYPE_NOTIFICATION_CATEGORIES)) {
      assert.equal(notificationCategoryAllowed(type, preferences), true, `${type}`);
    }
  }
});

test("an unrecognized push type is governed by the system category", () => {
  assert.equal(notificationCategoryForPushType("brand_new_event"), "systemNotifications");
  assert.equal(notificationCategoryAllowed("brand_new_event", { systemNotifications: false }), false);
  assert.equal(notificationCategoryAllowed("brand_new_event", { matchNotifications: false }), true);
});

test("the broker's own activation test is never blocked by a preference", () => {
  const everythingOff = Object.fromEntries(
    Object.values(PUSH_TYPE_NOTIFICATION_CATEGORIES)
      .concat("systemNotifications")
      .map(key => [key, false])
  );
  assert.deepEqual([...ALWAYS_ALLOWED_PUSH_TYPES], ["notification_test"]);
  assert.equal(notificationCategoryAllowed("notification_test", everythingOff), true);
  assert.equal(notificationCategoryAllowed("match", everythingOff), false);
});

test("only an explicit false blocks a notification, so partial documents are safe", () => {
  for (const value of [true, undefined, null, 0, "", "false"]) {
    assert.equal(
      notificationCategoryAllowed("match", { matchNotifications: value }),
      true,
      `value ${JSON.stringify(value)} must not silently block notifications`
    );
  }
  assert.equal(notificationCategoryAllowed("match", { matchNotifications: false }), false);
});

test("the public media route refuses any key outside the office image allow-list", async () => {
  const reads = [];
  const mediaEnv = { ...env, IAQAR_MEDIA: { get: async key => { reads.push(key); return null; } } };
  for (const key of [
    "public-intake/office-alqiq/request_123456/image-1.jpg",
    "office-covers/office-alqiq/private",
    "office-covers/office-alqiq/cover/extra",
    "office-covers/office-alqiq"
  ]) {
    const response = await worker.fetch(new Request(`https://example.test/media/public/${key}`), mediaEnv);
    assert.equal(response.status, 404, key);
  }
  assert.deepEqual(reads, [], "a rejected key must never reach the bucket");
});


test("pipeline classifies a client request", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({messageText:"مطلوب شقة تمليك في حي العقيق بحدود 650 ألف مساحة 150 متر 4 غرف"})
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.parsed.kind, "client_request");
  assert.equal(body.parsed.propertyType, "شقة");
  assert.equal(body.parsed.district, "العقيق");
  assert.equal(body.parsed.price, 650000);
});

test("pipeline classifies an owner offer", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({messageText:"للبيع فيلا في العزيزية بسعر مليون و200 ألف مساحة 400 متر"})
  }), env);
  const body = await response.json();
  assert.equal(body.parsed.kind, "owner_offer");
  assert.equal(body.parsed.propertyType, "فيلا");
  assert.equal(body.parsed.district, "العزيزية");
});

test("parser recognizes the unified property types and current Madinah districts", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({messageText:"للبيع دوبلكس في حي نبلاء بسعر مليون و200 ألف مساحة 350 متر، مالك مباشر"})
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.parsed.kind, "owner_offer");
  assert.equal(body.parsed.propertyType, "دوبلكس");
  assert.equal(body.parsed.district, "نبلاء");
  assert.equal(body.parsed.price, 1200000);
});

test("shared intake requires an authenticated office member", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/intake", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({officeId:"office-alqiq", messageText:"مطلوب شقة في العقيق"})
  }), env);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "firebase_not_configured");
});

test("parser extracts operational readiness fields", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({messageText:"مطلوب عاجل شقة تمليك في حي قباء من 600 ألف إلى 700 ألف مساحة 160 متر 4 غرف والعميل كاش"})
  }), env);
  const body = await response.json();
  assert.equal(body.parsed.urgency, "high");
  assert.equal(body.parsed.financingReady, true);
  assert.equal(body.parsed.priceMin, 600000);
  assert.equal(body.parsed.priceMax, 700000);
  assert.ok(body.parsed.confidence >= 50);
});

test("parser recognizes direct owner and street width", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({messageText:"للبيع أرض سكنية في حي السلام مالك مباشر مساحة 500 متر شارع 20 بسعر 900 ألف"})
  }), env);
  const body = await response.json();
  assert.equal(body.parsed.directOwner, true);
  assert.equal(body.parsed.streetWidth, 20);
  assert.equal(body.parsed.kind, "owner_offer");
});

test("analytics requires Firebase server configuration", async () => {
  const response = await worker.fetch(new Request("https://example.test/office/analytics?officeId=office-alqiq"), env);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "firebase_not_configured");
});

test("phase 2 parser extracts district price type operation phone and sender name", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      messageText: "مطلوب شقة تمليك في حي وادي العقيق من 650 ألف إلى 700 ألف مساحة 160 متر، الاسم: محمد الحربي، الجوال 0552019909"
    })
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.parsed.kind, "client_request");
  assert.equal(body.parsed.propertyType, "شقة");
  assert.equal(body.parsed.district, "وادي العقيق");
  assert.equal(body.parsed.transactionType, "sale");
  assert.equal(body.parsed.priceMin, 650000);
  assert.equal(body.parsed.priceMax, 700000);
  assert.equal(body.parsed.area, 160);
  assert.equal(body.parsed.phone, "+966552019909");
  assert.equal(body.parsed.senderName, "محمد الحربي");
});

test("phase 2 parser keeps fallback sender name and normalizes Saudi phone", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      messageText: "للإيجار فيلا في حي قباء بسعر 80 ألف مساحة 350 متر",
      senderName: "سالم المالك",
      senderPhone: "966501234567"
    })
  }), env);
  const body = await response.json();
  assert.equal(body.parsed.kind, "owner_offer");
  assert.equal(body.parsed.transactionType, "rent");
  assert.equal(body.parsed.senderName, "سالم المالك");
  assert.equal(body.parsed.phone, "+966501234567");
});

test("phase 2 parser reads compound million price", async () => {
  const response = await worker.fetch(new Request("https://example.test/pipeline/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({messageText:"للبيع عمارة في حي العزيزية بسعر مليون و200 ألف مساحة 600 متر"})
  }), env);
  const body = await response.json();
  assert.equal(body.parsed.price, 1200000);
});

test("phase 3 matching ranks candidates and selects the best opportunity", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      source: {kind:"client_request", district:"العقيق", propertyType:"شقة", transactionType:"sale", priceMin:600000, priceMax:700000, area:160, rooms:4, financingReady:true, urgency:"high", completeness:100},
      candidates: [
        {district:"العقيق", propertyType:"شقة", transactionType:"sale", price:650000, area:158, rooms:4, directOwner:true, completeness:100},
        {district:"العقيق", propertyType:"شقة", transactionType:"sale", price:760000, area:180, rooms:5, completeness:80},
        {district:"السلام", propertyType:"فيلا", transactionType:"sale", price:650000, area:400, rooms:7, completeness:100}
      ]
    })
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.matches.length >= 1);
  assert.equal(body.matches[0].rank, 1);
  assert.equal(body.matches[0].isBestOpportunity, true);
  assert.equal(body.matches[0].candidateIndex, 0);
  assert.ok(body.matches[0].score >= 85);
  assert.ok(body.matches[0].reasons.includes("نفس الحي"));
  assert.ok(body.matches[0].reasons.includes("السعر داخل الميزانية"));
});

test("phase 3 matching rejects a sale-rent conflict", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      source: {district:"قباء", propertyType:"فيلا", transactionType:"rent", price:80000, completeness:80},
      candidates: [{district:"قباء", propertyType:"فيلا", transactionType:"sale", price:80000, completeness:80}]
    })
  }), env);
  const body = await response.json();
  assert.equal(body.matches.length, 0);
  assert.equal(body.bestOpportunity, null);
});

test("phase 3 matching explains a close negotiable price", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      source: {district:"العزيزية", propertyType:"شقة", transactionType:"sale", priceMin:600000, priceMax:650000, area:150, completeness:80},
      candidates: [{district:"العزيزية", propertyType:"شقة", transactionType:"sale", price:700000, area:155, completeness:80}]
    })
  }), env);
  const body = await response.json();
  assert.equal(body.matches.length, 1);
  assert.ok(body.matches[0].reasons.some(reason => reason.includes("السعر")));
  assert.ok(body.matches[0].breakdown.price > 0);
});

test("phase 4 workflow preview advances the complete deal cycle", async () => {
  const expected = [
    ["contact", "viewing"],
    ["viewing", "negotiation"],
    ["negotiation", "agreement"],
    ["agreement", "closing"],
    ["closing", "closed"]
  ];
  for (const [currentStage, nextStage] of expected) {
    const response = await worker.fetch(new Request("https://example.test/workflow/preview", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({currentStage})
    }), env);
    const body = await response.json();
    assert.equal(body.nextStage, nextStage);
  }
});

test("phase 4 analytics preview calculates dashboard statistics", async () => {
  const response = await worker.fetch(new Request("https://example.test/office/analytics/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      clients:[{district:"العقيق",propertyType:"شقة"},{district:"العقيق",propertyType:"شقة"}],
      owners:[{district:"قباء",propertyType:"فيلا"}],
      matches:[{score:92,opportunityScore:97,district:"العقيق",propertyType:"شقة",matchId:"mat_1",reasons:["نفس الحي"]},{score:80}],
      deals:[
        {status:"closed",workflowStage:"closed",commissionActual:12000},
        {status:"open",workflowStage:"negotiation",commissionExpected:9000},
        {status:"lost",workflowStage:"lost"}
      ]
    })
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.counts.clients, 2);
  assert.equal(body.counts.closedDeals, 1);
  assert.equal(body.topDistrict, "العقيق");
  assert.equal(body.topPropertyType, "شقة");
  assert.equal(body.commissionActual, 12000);
  assert.equal(body.commissionExpected, 9000);
  assert.equal(body.bestOpportunity.matchId, "mat_1");
  assert.equal(body.pipeline.negotiation, 1);
});

test("phase 4 FCM configuration is disabled without a VAPID key", async () => {
  const response = await worker.fetch(new Request("https://example.test/fcm/config"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.enabled, false);
  assert.equal(body.vapidKey, "");
});

test("closing readiness uses the approved four labels", async () => {
  const response = await worker.fetch(new Request("https://example.test/workflow/readiness/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      score: 96,
      status: "negotiation",
      source: {completeness:100, financingReady:true, urgency:"high"},
      candidate: {completeness:100, directOwner:true}
    })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.readiness.key, "very_high");
  assert.equal(body.readiness.label, "عالية جدًا");
  assert.equal(body.statusLabel, "تفاوض");
});

test("closing readiness moves with match workflow stage", async () => {
  const labels = [];
  for (const status of ["active", "waiting_response", "viewing", "negotiation", "completed", "closed"]) {
    const response = await worker.fetch(new Request("https://example.test/workflow/readiness/preview", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({score:70,status})
    }), env);
    const body = await response.json();
    labels.push([status, body.readiness.score, body.readiness.label]);
  }
  assert.ok(labels.find(([status]) => status === "viewing")[1] >= 70);
  assert.ok(labels.find(([status]) => status === "negotiation")[1] >= 85);
  assert.equal(labels.find(([status]) => status === "completed")[1], 100);
  assert.equal(labels.find(([status]) => status === "closed")[1], 0);
});

test("matching rejects illogical district and property type conflict", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      source: {district:"العقيق",propertyType:"شقة",transactionType:"sale",price:650000,completeness:90},
      candidates: [{district:"قباء",propertyType:"فيلا",transactionType:"sale",price:650000,completeness:90}]
    })
  }), env);
  const body = await response.json();
  assert.equal(body.matches.length, 0);
});

test("matching rejects a price gap above forty percent", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      source: {district:"العقيق",propertyType:"شقة",transactionType:"sale",priceMax:600000,completeness:90},
      candidates: [{district:"العقيق",propertyType:"شقة",transactionType:"sale",price:1200000,completeness:90}]
    })
  }), env);
  const body = await response.json();
  assert.equal(body.matches.length, 0);
});

test("analytics preview includes morning priorities", async () => {
  const now = Date.now();
  const response = await worker.fetch(new Request("https://example.test/office/analytics/preview", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      matches:[
        {status:"active",score:94,closingReadinessScore:90,closingReadinessLabel:"عالية جدًا",matchId:"mat_best",nextFollowUpAt:new Date(now-3600000).toISOString()},
        {status:"closed",score:88,closingReadinessScore:0}
      ],
      deals:[
        {status:"open",workflowStage:"negotiation",commissionExpected:15000,nextFollowUpAt:new Date(now+3600000).toISOString()}
      ]
    })
  }), env);
  const body = await response.json();
  assert.equal(body.morningSummary.dueFollowUps, 1);
  assert.equal(body.morningSummary.veryReady, 1);
  assert.equal(body.morningSummary.negotiationDeals, 1);
  assert.equal(body.bestOpportunity.matchId, "mat_best");
});

test("stage 2 matching returns only the best three opportunities", async () => {
  const candidates = Array.from({length: 6}, (_, index) => ({
    city:"المدينة المنورة", district:"العقيق", propertyType:"شقة", transactionType:"sale",
    price:650000 + index * 5000, area:160 + index, rooms:4, completeness:90
  }));
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({source:{city:"المدينة المنورة",district:"العقيق",propertyType:"شقة",transactionType:"sale",price:650000,area:160,rooms:4,completeness:90},candidates})
  }), env);
  const body = await response.json();
  assert.equal(body.matches.length, 3);
  assert.deepEqual(body.matches.map(item => item.rank), [1,2,3]);
});

test("stage 2 matching records precise price and area differences", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      source:{city:"المدينة المنورة",district:"قباء",propertyType:"فيلا",transactionType:"sale",price:1000000,area:400,completeness:90},
      candidates:[{city:"المدينة المنورة",district:"قباء",propertyType:"فيلا",transactionType:"sale",price:1030000,area:420,completeness:90}]
    })
  }), env);
  const body = await response.json();
  assert.equal(body.matches.length, 1);
  assert.equal(body.matches[0].metrics.priceDifferencePercent, 3);
  assert.equal(body.matches[0].metrics.areaDifferencePercent, 5);
  assert.ok(body.matches[0].reasons.some(reason => reason.includes("فرق السعر 3٪")));
});


test("stage 3 notification links open the exact office record", () => {
  assert.equal(buildNotificationLink({officeId:"office-alqiq",type:"match",recordId:"mat_123"}), "/?officeId=office-alqiq&openMatch=mat_123");
  assert.equal(buildNotificationLink({officeId:"office-alqiq",type:"deal",recordId:"deal_9"}), "/?officeId=office-alqiq&openDeal=deal_9");
  assert.equal(buildNotificationLink({officeId:"platform",type:"broker_application",recordId:"broker_7"}), "/?office=platform&adminApplications=1&openBrokerApplication=broker_7");
  assert.equal(buildNotificationLink({officeId:"office-alqiq",type:"notification_test",recordId:"test_1"}), "/?officeId=office-alqiq");
});

test("stage 3 recognizes expired FCM tokens for automatic cleanup", () => {
  const result = parseFcmFailure({error:{status:"NOT_FOUND",message:"Requested entity was not found.",details:[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError",errorCode:"UNREGISTERED"}]}},404);
  assert.equal(result.code, "UNREGISTERED");
  assert.equal(result.staleToken, true);
});

test("stage 3 FCM config requires both VAPID and Firebase server credentials", async () => {
  const response = await worker.fetch(new Request("https://example.test/fcm/config"), {
    FIREBASE_PROJECT_ID:"aqar-b5d76",
    FCM_WEB_PUSH_VAPID_KEY:"A".repeat(60),
    FIREBASE_CLIENT_EMAIL:"firebase-adminsdk@example.test",
    FIREBASE_PRIVATE_KEY:"-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----"
  });
  const body = await response.json();
  assert.equal(body.vapidConfigured, true);
  assert.equal(body.serverReady, true);
  assert.equal(body.enabled, true);
});

test("opportunity source media accepts only approved Phase 2 source types", () => {
  assert.equal(normalizeOpportunitySourceType("pdf"), "pdf");
  assert.equal(normalizeOpportunitySourceType("IMAGE"), "image");
  assert.equal(normalizeOpportunitySourceType("screenshot"), "screenshot");
  assert.equal(normalizeOpportunitySourceType("word"), "word");
  assert.equal(normalizeOpportunitySourceType("excel"), "excel");
  assert.equal(normalizeOpportunitySourceType("audio"), "audio");
  assert.equal(normalizeOpportunitySourceType("url"), "");
  assert.equal(normalizeOpportunitySourceType("text"), "");
  assert.equal(normalizeOpportunitySourceType(""), "");
});

test("Phase 4 matching preview exposes rule version and threshold from one config", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: {
        district: "العقيق", propertyType: "شقة", transactionType: "sale",
        price: 650000, area: 160, rooms: 4, completeness: 90
      },
      candidates: [{
        district: "العقيق", propertyType: "شقة", transactionType: "sale",
        price: 650000, area: 160, rooms: 4, completeness: 90
      }]
    })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.matchingRuleVersion, MATCHING_RULE_VERSION);
  assert.equal(body.threshold, MATCH_THRESHOLD);
  assert.equal(body.boundaries.createsOperation, false);
  assert.ok(body.matches.length >= 1);
});

test("Phase 4 match ids include rule and data versions and stay idempotent", async () => {
  const left = {
    opportunityKind: "OFFER", purpose: "SALE", city: "الرياض", district: "النرجس",
    propertyType: "شقة", price: 1000000, area: 150, rooms: 3, completeness: 90, version: 1
  };
  const right = {
    opportunityKind: "REQUEST", purpose: "PURCHASE", city: "الرياض", district: "النرجس",
    propertyType: "شقة", price: 1050000, area: 148, rooms: 3, completeness: 90, version: 1
  };
  const pairKey = canonicalPairKey("opportunities:a", "opportunities:b");
  const dataVersion = await relevantDataVersion(left, right);
  const first = await buildMatchId({
    officeId: "office-a", pairKey, matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion
  });
  const second = await buildMatchId({
    officeId: "office-a", pairKey, matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion
  });
  assert.equal(first, second);
  const scored = scoreMatch(left, right);
  assert.equal(scored.eligible, true);
  assert.equal(phase4BoundaryGuarantees().createsOperation, false);
});

test("Phase 4 matching/run requires authentication", async () => {
  const response = await worker.fetch(new Request("https://example.test/matching/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeId: "office-a", opportunityId: "opp_1" })
  }), env);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test("Phase 5 boundaries allow drafts but never claim send or deals", async () => {
  const { phase5BoundaryGuarantees } = await import("../src/operations-domain.js");
  const g = phase5BoundaryGuarantees();
  // Phase 7: draft flags are true; Cloud API / Bot send remains false.
  assert.equal(g.createsWhatsAppMessage, true);
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.createsTelegramMessage, true);
  assert.equal(g.sendsTelegram, false);
  assert.equal(g.createsSmartMessageDraft, true);
  assert.equal(g.createsAutomaticCooperation, false);
  assert.equal(g.createsDeal, false);
  assert.equal(g.addsDealsPage, false);
  assert.equal(g.addsBottomNavigation, false);
});

test("Phase 5 operation deep links open Operations Center records", () => {
  assert.equal(
    buildNotificationLink({ officeId: "office-1", type: "missing_data", recordId: "op_abc" }),
    "/?officeId=office-1&openOperation=op_abc"
  );
  assert.equal(
    buildNotificationLink({ officeId: "office-1", type: "match", recordId: "op_xyz" }),
    "/?officeId=office-1&openOperation=op_xyz"
  );
  assert.ok(
    buildNotificationLink({ officeId: "office-1", type: "match", recordId: "mat_legacy" }).includes("openMatch=mat_legacy")
  );
});

test("Phase 5 operations endpoints require authentication", async () => {
  for (const path of ["/operations/action", "/operations/from-cooperation", "/operations/missing-data"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: "office-a", operationId: "op_1", action: "START", cooperationId: "c1", opportunityId: "o1" })
    }), env);
    assert.equal(response.status, 401, path);
  }
});

test("Phase 6 cooperation lifecycle endpoints require authentication", async () => {
  const endpoints = [
    {
      path: "/cooperation/request",
      body: {
        officeId: "office-a",
        targetOfficeId: "office-b",
        opportunityIds: ["opp_1"],
        scopeType: "single"
      }
    },
    {
      path: "/cooperation/lifecycle",
      body: {
        officeId: "office-a",
        cooperationId: "coop_1",
        sharingScopeId: "scope_1",
        action: "ACCEPT"
      }
    },
    {
      path: "/cooperation/scope-revoke",
      body: {
        officeId: "office-a",
        cooperationId: "coop_1",
        sharingScopeId: "scope_1",
        action: "ACCEPT"
      }
    }
  ];
  for (const { path, body } of endpoints) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }), env);
    assert.equal(response.status, 401, path);
  }
});

test("Phase 6 boundaries export denies automatic cooperation", async () => {
  assert.equal(phase6BoundaryGuarantees().createsAutomaticCooperation, false);
  assert.equal(phase6BoundaryGuarantees().createsBrokerRecommendation, false);
  assert.equal(phase6BoundaryGuarantees().smartAutomaticImplemented, false);
});

test("Phase 7 message draft/handoff endpoints require authentication", async () => {
  for (const path of ["/messages/draft", "/messages/handoff"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: "office-a",
        messageId: "msg_1",
        channel: "whatsapp",
        contactPhone: "0551234567",
        body: "مسودة"
      })
    }), env);
    assert.equal(response.status, 401, path);
  }
});

test("Phase 7 adapters endpoint and boundaries deny outbound send", async () => {
  const response = await worker.fetch(new Request("https://example.test/messages/adapters"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.whatsapp.adapterStatus, "adapter_ready");
  assert.equal(body.telegram.adapterStatus, "simulated");
  assert.equal(body.boundaries.sendsWhatsApp, false);
  assert.equal(body.boundaries.sendsTelegram, false);
  assert.equal(body.boundaries.autoSendsMessages, false);
  assert.equal(phase7BoundaryGuarantees().claimsFakeDelivery, false);
});

test("Phase 8 public intake rate limit returns 429 after the window is exhausted", async () => {
  const { resetPublicRateLimitStoreForTests, PUBLIC_RATE_LIMITS } = await import("../src/public-rate-limit.js");
  resetPublicRateLimitStoreForTests();
  const headers = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": "198.51.100.20"
  };
  const payload = JSON.stringify({ officeId: "office-limit", intakeId: "intakelimit1" });
  for (let i = 0; i < PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit; i += 1) {
    const response = await worker.fetch(new Request("https://example.test/pipeline/public-intake", {
      method: "POST",
      headers,
      body: payload
    }), env);
    assert.notEqual(response.status, 429);
  }
  const blocked = await worker.fetch(new Request("https://example.test/pipeline/public-intake", {
    method: "POST",
    headers,
    body: payload
  }), env);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, "rate_limited");
});
