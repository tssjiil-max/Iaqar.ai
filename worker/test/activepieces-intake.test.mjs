import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import worker from "../src/index.js";
import {
  ACTIVEPIECES_SOURCE,
  STAGING_FIREBASE_PROJECT,
  authorizeActivepieces,
  composeActivepiecesMessage,
  isStagingFirebaseEnv,
  validateActivepiecesIntakeBody
} from "../src/activepieces-intake.mjs";

const root = path.resolve(import.meta.dirname, "..");
const TOKEN = "test-activepieces-token";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const stagingEnv = {
  DEPLOYMENT_ENV: "staging",
  FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT,
  FIREBASE_CLIENT_EMAIL: "sa@iaqar-ai-staging.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_PRIVATE_KEY_ID: "test-key",
  ACTIVEPIECES_INGEST_TOKEN: TOKEN
};

function validBody(overrides = {}) {
  return {
    idempotencyKey: "ap-key-1",
    source: "activepieces",
    officeId: "office-staging",
    type: "owner_offer",
    rawText: "للبيع فيلا في العزيزية بسعر مليون مساحة 400 متر",
    extracted: {
      city: "المدينة المنورة",
      neighborhood: "العزيزية",
      propertyType: "فيلا",
      purpose: "بيع",
      price: 1000000,
      area: 400,
      contactPhone: "0552019909"
    },
    ...overrides
  };
}

function request(method, body, headers = {}) {
  return new Request("https://example.test/activepieces/intake", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
}

function authHeaders(token = TOKEN) {
  return { Authorization: `Bearer ${token}` };
}

function installFirestoreMock({ duplicateOn = 0 } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let inboxPosts = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ url, method });
    if (url.includes("oauth2.googleapis.com")) {
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (url.includes("firestore.googleapis.com") && method === "POST" && url.includes("/inbox")) {
      inboxPosts += 1;
      if (duplicateOn && inboxPosts >= duplicateOn) {
        return new Response("", { status: 409 });
      }
      return Response.json({ name: "ok" }, { status: 200 });
    }
    if (url.includes("firestore.googleapis.com") && method === "GET" && url.includes("/inbox/")) {
      return Response.json({
        fields: { opportunityId: { stringValue: "opp_existing_ap" } }
      });
    }
    if (url.includes("firestore.googleapis.com")) {
      return Response.json({ documents: [] }, { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  };
  return {
    calls,
    restore() { globalThis.fetch = originalFetch; }
  };
}

test("401 without Authorization", async () => {
  const response = await worker.fetch(request("POST", validBody()), stagingEnv);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error, "unauthorized");
});

test("401 with a wrong token", async () => {
  const response = await worker.fetch(
    request("POST", validBody(), authHeaders("wrong-token")),
    stagingEnv
  );
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.opportunityId, "");
});

test("400 when idempotencyKey is missing", async () => {
  const payload = validBody();
  delete payload.idempotencyKey;
  const response = await worker.fetch(request("POST", payload, authHeaders()), stagingEnv);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.ok(body.missingFields.includes("idempotencyKey"));
});

test("400 when type is not allowed", async () => {
  const response = await worker.fetch(
    request("POST", validBody({ type: "deal" }), authHeaders()),
    stagingEnv
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.ok(body.missingFields.includes("type"));
});

test("GET /activepieces/intake returns 405", async () => {
  const response = await worker.fetch(request("GET", null, authHeaders()), stagingEnv);
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.equal(body.error, "method_not_allowed");
});

test("owner_offer succeeds through the existing inbox save path", async () => {
  const mock = installFirestoreMock();
  try {
    const response = await worker.fetch(
      request("POST", validBody({ idempotencyKey: "owner-1" }), authHeaders()),
      stagingEnv
    );
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.duplicate, false);
    assert.ok(String(body.opportunityId).startsWith("opp_"));
    assert.ok(mock.calls.every((call) => !call.url.includes("aqar-b5d76")));
    assert.ok(mock.calls.some((call) => (
      call.method === "POST"
      && call.url.includes(`/projects/${STAGING_FIREBASE_PROJECT}/`)
      && call.url.includes("/inbox")
    )));
  } finally {
    mock.restore();
  }
});

test("buyer_request succeeds through the existing inbox save path", async () => {
  const mock = installFirestoreMock();
  try {
    const response = await worker.fetch(
      request("POST", validBody({
        idempotencyKey: "buyer-1",
        type: "buyer_request",
        rawText: "مطلوب شقة تمليك في حي العقيق بحدود 650 ألف مساحة 150 متر"
      }), authHeaders()),
      stagingEnv
    );
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.ok(body.opportunityId);
  } finally {
    mock.restore();
  }
});

test("repeating the same idempotencyKey does not create a second record", async () => {
  const mock = installFirestoreMock({ duplicateOn: 2 });
  try {
    const first = await worker.fetch(
      request("POST", validBody({ idempotencyKey: "same-key" }), authHeaders()),
      stagingEnv
    );
    const second = await worker.fetch(
      request("POST", validBody({ idempotencyKey: "same-key" }), authHeaders()),
      stagingEnv
    );
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const body = await second.json();
    assert.equal(body.success, true);
    assert.equal(body.duplicate, true);
    assert.equal(body.opportunityId, "opp_existing_ap");
    assert.equal(mock.calls.filter((call) => call.method === "POST" && call.url.includes("/inbox")).length, 2);
  } finally {
    mock.restore();
  }
});

test("request cannot choose a Firebase project and production env is rejected", async () => {
  const blocked = await worker.fetch(
    request("POST", validBody({ projectId: "aqar-b5d76" }), authHeaders()),
    stagingEnv
  );
  assert.equal(blocked.status, 400);

  const prod = await worker.fetch(
    request("POST", validBody(), authHeaders()),
    { ...stagingEnv, DEPLOYMENT_ENV: "production", FIREBASE_PROJECT_ID: "aqar-b5d76" }
  );
  assert.equal(prod.status, 404);
  assert.equal(isStagingFirebaseEnv({ DEPLOYMENT_ENV: "staging", FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT }), true);
  assert.equal(isStagingFirebaseEnv({ DEPLOYMENT_ENV: "staging", FIREBASE_PROJECT_ID: "aqar-b5d76" }), false);
});

test("/meta/webhook routes and handlers are unchanged", () => {
  const source = readFileSync(path.join(root, "src", "index.js"), "utf8");
  assert.match(source, /if \(request\.method === "GET" && url\.pathname === "\/meta\/webhook"\) \{\s*return verifyWebhook\(url, env\);/);
  assert.match(source, /if \(request\.method === "POST" && url\.pathname === "\/meta\/webhook"\) \{\s*return receiveMetaWebhook\(request, env, requestId\);/);
  assert.match(source, /async function receiveMetaWebhook\(request, env, requestId\) \{\s*assertMetaWebhookSecrets\(env\);/);
  const webhookStart = source.indexOf("async function receiveMetaWebhook");
  const webhookEnd = source.indexOf("async function completeEmbeddedSignup");
  const webhookFn = source.slice(webhookStart, webhookEnd);
  assert.ok(webhookStart > 0 && webhookEnd > webhookStart);
  assert.equal(webhookFn.includes("activepieces"), false);
  assert.equal(webhookFn.includes("ACTIVEPIECES_INGEST_TOKEN"), false);
});

test("staging Wrangler env is locked to iaqar-ai-staging", () => {
  const toml = readFileSync(path.join(root, "wrangler.toml"), "utf8");
  const staging = toml.split("[env.staging]")[1] || "";
  assert.ok(staging.includes('name = "iaqar-intake-staging"'));
  assert.ok(staging.includes(`FIREBASE_PROJECT_ID = "${STAGING_FIREBASE_PROJECT}"`));
  assert.equal(staging.includes('FIREBASE_PROJECT_ID = "aqar-b5d76"'), false);
  assert.equal(toml.includes("ACTIVEPIECES_INGEST_TOKEN"), false);
});

test("GET / still reports the official intake service and unchanged webhook path", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), {
    DEPLOYMENT_ENV: "staging",
    FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT
  });
  const body = await response.json();
  assert.equal(body.service, "iaqar-whatsapp-official-intake");
  assert.equal(body.webhook, "/meta/webhook");
});

test("helpers reject a wrong token without echoing it", () => {
  const result = authorizeActivepieces(
    new Request("https://example.test/", { headers: { Authorization: "Bearer other" } }),
    { ACTIVEPIECES_INGEST_TOKEN: TOKEN }
  );
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  const composed = composeActivepiecesMessage(validateActivepiecesIntakeBody(validBody()));
  assert.ok(composed.includes("عرض مالك"));
  assert.equal(ACTIVEPIECES_SOURCE, "activepieces");
});
