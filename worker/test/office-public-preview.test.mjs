import test from "node:test";
import assert from "node:assert/strict";
import {
  handleOfficeShareCardGet,
  handleOfficeShareCardUpload,
  handlePublicOfficePreview,
  handlePublicOfficeSharePage,
  handleSavePublicSlug,
  officeShareCardStorageKey
} from "../src/office-public-preview.js";

function appError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function previewDeps({ slugOfficeId = "staging-logo-live-20260807", claimedBy = "", publicRows = [], extraFields = {}, bucket = null } = {}) {
  return {
    projectId: "iaqar-ai-staging",
    accessToken: "token",
    getFirestoreDocument: async ({ segments }) => {
      if (segments[0] === "officeSlugClaims") {
        const owner = claimedBy || slugOfficeId;
        return { fields: { officeId: { stringValue: owner } } };
      }
      if (segments[0] === "publicOffices") {
        return {
          fields: {
            officeId: { stringValue: slugOfficeId },
            officeName: { stringValue: "Staging Logo Live" },
            city: { stringValue: "المدينة المنورة" },
            licenseNumber: { stringValue: "1234567890" },
            publicSlug: { stringValue: "wadi" },
            shareCardNonce: { stringValue: "abc123" },
            sharePreviewFormat: { stringValue: "immutable-v2" },
            ...extraFields
          }
        };
      }
      if (segments[0] === "offices") {
        return { fields: { officeId: { stringValue: slugOfficeId }, publicSlug: { stringValue: "old-slug" } } };
      }
      return null;
    },
    runFirestoreQuery: async () => publicRows,
    setFirestoreDocument: async () => ({}),
    deleteFirestoreDocument: async () => ({}),
    firestoreFieldsToJs: (fields) => Object.fromEntries(
      Object.entries(fields || {}).map(([key, value]) => [key, value.booleanValue ?? (value.stringValue || value.timestampValue || "")])
    ),
    firestoreHelpers: {
      firestoreString: (value) => ({ stringValue: value }),
      firestoreTimestamp: (value) => ({ timestampValue: value.toISOString() })
    },
    authorizeOfficeRequest: async () => ({ uid: "mgr" }),
    resolveAppOrigin: () => "https://iaqar-ai-staging--staging-9c4b0k7h.web.app",
    firestoreOfficeId: (value) => String(value || "").trim(),
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    requireMediaBucket: () => bucket,
    requestId: "req-test",
    appError
  };
}

test("legacy /m WhatsApp crawler still receives OG HTML, now pointing at immutable JPEG media", async () => {
  const response = await handlePublicOfficePreview(
    new Request("https://iaqar-intake-staging.iaqar-ai.workers.dev/m/wadi", {
      headers: { "user-agent": "WhatsApp/2.2492.3 N" }
    }),
    {},
    previewDeps()
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /property="og:title" content="Staging Logo Live"/);
  assert.match(
    html,
    /property="og:image" content="https:\/\/iaqar-intake-staging\.iaqar-ai\.workers\.dev\/share\/office\/staging-logo-live-20260807\/abc123\.jpg"/
  );
  assert.match(html, /property="og:description" content="مكتب عقاري مرخص في المدينة المنورة"/);
  assert.match(html, /property="og:type" content="website"/);
  assert.match(html, /property="og:url" content="https:\/\/iaqar-ai-staging--staging-9c4b0k7h\.web\.app\/m\/wadi"/);
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  assert.equal(html.includes("http-equiv=\"refresh\""), false);
  assert.equal(response.headers.get("x-iaqar-crawler"), "1");
});

test("immutable /s page is always 200 OG HTML and separates canonical from og:url", async () => {
  const response = await handlePublicOfficeSharePage(
    new Request("https://iaqar-intake-staging.iaqar-ai.workers.dev/s/wadi/version-2", {
      headers: { "user-agent": "Mozilla/5.0 Chrome/126" }
    }),
    {},
    previewDeps()
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-iaqar-office-preview"), "immutable-share");
  assert.equal(response.headers.get("x-iaqar-share-version"), "version-2");
  assert.match(html, /rel="canonical" href="https:\/\/iaqar-ai-staging--staging-9c4b0k7h\.web\.app\/m\/wadi"/);
  assert.match(html, /property="og:url" content="https:\/\/iaqar-intake-staging\.iaqar-ai\.workers\.dev\/s\/wadi\/version-2"/);
  assert.match(html, /property="og:image" content="https:\/\/iaqar-intake-staging\.iaqar-ai\.workers\.dev\/share\/office\/staging-logo-live-20260807\/version-2\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  assert.match(html, /location\.replace\("https:\/\/iaqar-ai-staging--staging-9c4b0k7h\.web\.app\/\?office=staging-logo-live-20260807&view=public"\)/);
});

test("browser hits on the permanent Worker /m link still land on the Hosting public office page", async () => {
  const response = await handlePublicOfficePreview(
    new Request("https://iaqar-intake-staging.iaqar-ai.workers.dev/m/wadi", {
      headers: { "user-agent": "Mozilla/5.0 Chrome/126" },
      redirect: "manual"
    }),
    {},
    previewDeps()
  );
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/?office=staging-logo-live-20260807&view=public"
  );
});

function memoryBucket() {
  const map = new Map();
  let puts = 0;
  return {
    map,
    get puts() { return puts; },
    async get(key) {
      const row = map.get(key);
      if (!row) return null;
      return {
        body: row.bytes,
        writeHttpMetadata(headers) {
          headers.set("content-type", row.contentType);
          headers.set("cache-control", row.cacheControl);
        }
      };
    },
    async put(key, bytes, meta = {}) {
      puts += 1;
      map.set(key, {
        bytes,
        contentType: meta.httpMetadata?.contentType || "image/jpeg",
        cacheControl: meta.httpMetadata?.cacheControl || ""
      });
    }
  };
}

test("upload stores immutable version key once; GET and HEAD return public JPEG with immutable cache", async () => {
  const bucket = memoryBucket();
  const deps = previewDeps({ bucket });
  const makeUpload = () => new Request("https://worker.example/media/office-share-card", {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-office-id": "office-a",
      "x-public-slug": "wadi",
      "x-share-card-version": "ver-1"
    },
    body: new Uint8Array([255, 216, 255, 217])
  });
  const first = await handleOfficeShareCardUpload(makeUpload(), {}, deps);
  assert.equal(first.status, 201);
  const second = await handleOfficeShareCardUpload(makeUpload(), {}, deps);
  assert.equal(second.status, 200);
  assert.equal(bucket.puts, 1, "same immutable version is never overwritten");
  const key = officeShareCardStorageKey("office-a", "ver-1");
  assert.equal(key, "office-share/office-a/ver-1.jpg");
  assert.ok(bucket.map.has(key));

  for (const method of ["GET", "HEAD"]) {
    const response = await handleOfficeShareCardGet(
      new Request("https://worker.example/share/office/office-a/ver-1.jpg", { method }),
      {},
      deps
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.match(response.headers.get("cache-control"), /immutable/);
    assert.equal(response.headers.get("location"), null);
  }
});

test("legacy missing share-card URL still falls back to the platform PNG", async () => {
  const deps = {
    requireMediaBucket: () => ({ get: async () => null }),
    resolveAppOrigin: () => "https://host.example",
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
    fetch: async (_url, { method }) => new Response(method === "HEAD" ? null : new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png" }
    }),
    appError
  };
  for (const method of ["GET", "HEAD"]) {
    const response = await handleOfficeShareCardGet(
      new Request("https://worker.example/share/office/wadi/card-v1.png", { method }),
      {},
      deps
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  }
});

test("public slug uniqueness rejects another office", async () => {
  await assert.rejects(
    () => handleSavePublicSlug(
      new Request("https://worker.test/office/public-slug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ officeId: "office-a", publicSlug: "wadi" })
      }),
      {},
      previewDeps({ claimedBy: "office-b" })
    ),
    (error) => error.code === "slug_taken" && String(error.message).includes("جرّب:")
  );
});
