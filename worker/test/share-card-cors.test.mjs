import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("browser preflight for the share-card upload allows every header the client sends", async () => {
  const response = await worker.fetch(new Request("https://worker.test/media/office-share-card", {
    method: "OPTIONS",
    headers: { origin: "https://iaqar-ai-staging--staging-x.web.app", "access-control-request-method": "POST" }
  }), {}, { waitUntil() {} });
  const allowed = String(response.headers.get("access-control-allow-headers") || "").toLowerCase().split(",").map((v) => v.trim());
  for (const header of ["content-type", "authorization", "x-office-id", "x-public-slug", "x-share-card-version"]) {
    assert.ok(allowed.includes(header), `missing CORS header: ${header}`);
  }
});
