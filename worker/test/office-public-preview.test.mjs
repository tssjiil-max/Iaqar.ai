import test from "node:test";
import assert from "node:assert/strict";
import { handlePublicOfficePreview, handleSavePublicSlug } from "../src/office-public-preview.js";

function appError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function previewDeps({ slugOfficeId = "staging-logo-live-20260807", claimedBy = "", publicRows = [] } = {}) {
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
            publicSlug: { stringValue: "wadi" }
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
      Object.entries(fields || {}).map(([key, value]) => [key, value.stringValue || value.timestampValue || ""])
    ),
    firestoreHelpers: {
      firestoreString: (value) => ({ stringValue: value }),
      firestoreTimestamp: (value) => ({ timestampValue: value.toISOString() })
    },
    authorizeOfficeRequest: async () => ({ uid: "mgr" }),
    resolveAppOrigin: () => "https://iaqar-ai-staging--staging-9c4b0k7h.web.app",
    normalizeOfficeId: (value) => String(value || "").trim(),
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    appError
  };
}

test("WhatsApp crawler receives OG HTML without a meta-refresh", async () => {
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
  assert.match(html, /property="og:image" content="https:\/\/iaqar-intake-staging.iaqar-ai.workers.dev\/share\/office\/staging-logo-live-20260807\/card-v/);
  assert.equal(html.includes("http-equiv=\"refresh\""), false);
  assert.equal(html.includes("cv2Party"), false);
  assert.equal(response.headers.get("x-iaqar-crawler"), "1");
});

test("browser hits on the Worker short link redirect to Hosting /m/{slug}", async () => {
  const response = await handlePublicOfficePreview(
    new Request("https://iaqar-intake-staging.iaqar-ai.workers.dev/o/staging-logo-live-1pbwwl", {
      headers: { "user-agent": "Mozilla/5.0 Chrome/126" },
      redirect: "manual"
    }),
    {},
    previewDeps()
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/m/wadi");
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
    (error) => error.code === "slug_taken"
  );
});
