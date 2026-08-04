import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import worker, { buildNotificationLink, buildFcmTarget, buildFcmHttpMessage, createServiceAccountJwt, firebaseServiceAccount, legacyLocalLoginPhone, normalizeLoginPhone, parseFcmFailure, resolveLoginDirectory, officeImageKeyParts, isPublicOfficeImageKey, normalizeOfficeId } from "../src/index.js";

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

test("phase 1 office image kinds map to safe storage folders", () => {
  assert.deepEqual(officeImageKeyParts("logo"), { folder: "office-logos", name: "logo" });
  assert.deepEqual(officeImageKeyParts("cover"), { folder: "office-covers", name: "cover" });
  assert.deepEqual(officeImageKeyParts(""), { folder: "office-covers", name: "cover" });
  assert.equal(officeImageKeyParts("passwd"), null);
  assert.equal(officeImageKeyParts("../secret"), null);
});

test("phase 1 public office image keys reject traversal and foreign paths", () => {
  assert.equal(isPublicOfficeImageKey("office-covers/office-alqiq/cover"), true);
  assert.equal(isPublicOfficeImageKey("office-logos/office-alqiq/logo"), true);
  assert.equal(isPublicOfficeImageKey("office-covers/office-alqiq/../secret"), false);
  assert.equal(isPublicOfficeImageKey("public-intake/office-alqiq/x/image-1.jpg"), false);
  assert.equal(isPublicOfficeImageKey("office-covers//cover"), false);
});

test("phase 1 office image upload requires authentication", async () => {
  const response = await worker.fetch(new Request("https://example.test/media/office-image", {
    method: "POST",
    headers: { "content-type": "image/webp", "x-office-id": "office-b", "x-media-kind": "logo", "content-length": "1000" },
    body: "x"
  }), { ...env, IAQAR_MEDIA: { put: async () => {}, get: async () => null, delete: async () => {} } });
  assert.equal(response.status, 401);
});

test("phase 1 office image upload rejects an unsupported kind before storing", async () => {
  let putCalled = false;
  const response = await worker.fetch(new Request("https://example.test/media/office-image", {
    method: "POST",
    headers: {
      "content-type": "image/webp", "x-office-id": "office-alqiq",
      "x-media-kind": "secrets", "content-length": "1000"
    },
    body: "x"
  }), { ...env, ALLOW_TRIAL_NO_AUTH: "true", IAQAR_MEDIA: { put: async () => { putCalled = true; }, get: async () => null, delete: async () => {} } });
  assert.equal(response.status, 400);
  assert.equal(putCalled, false);
});

test("phase 1 office image upload stores logo under the office-scoped key", async () => {
  const puts = [];
  const response = await worker.fetch(new Request("https://example.test/media/office-image", {
    method: "POST",
    headers: {
      "content-type": "image/webp", "x-office-id": "office-alqiq",
      "x-media-kind": "logo", "content-length": "1000"
    },
    body: "x"
  }), { ...env, ALLOW_TRIAL_NO_AUTH: "true", IAQAR_MEDIA: { put: async (key) => { puts.push(key); }, get: async () => null, delete: async () => {} } });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.kind, "logo");
  assert.deepEqual(puts, ["office-logos/office-alqiq/logo"]);
  assert.match(body.imageUrl, /\/media\/public\/office-logos\/office-alqiq\/logo/);
});

test("office id normalization strips unsafe characters", () => {
  assert.equal(normalizeOfficeId("Office ALQIQ!!"), "office-alqiq");
  assert.equal(normalizeOfficeId("../../etc"), "etc");
});
