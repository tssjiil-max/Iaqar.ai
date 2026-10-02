import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nonceKey, isHostedPreviewHost, officePermanentUrl, officeShareUrl, previewVersion, shareCardKey } from "../public/os/domain/share-card-domain.js";

test("permanent office URL stays /m while hosted sharing uses immutable Worker /s URL", () => {
  const base = {
    slug: "Sultan",
    officeId: "o1",
    origin: "https://iaqar-ai-staging--staging-x.web.app",
    workerOrigin: "https://w.example.workers.dev/",
    preview: "abc123"
  };
  assert.equal(officePermanentUrl(base), "https://iaqar-ai-staging--staging-x.web.app/m/sultan");
  assert.equal(
    officeShareUrl({ ...base, hostname: "iaqar-ai-staging--staging-x.web.app" }),
    "https://w.example.workers.dev/s/sultan/abc123"
  );
  assert.equal(
    officeShareUrl({ ...base, origin: "https://iaqar.ai", hostname: "iaqar.ai" }),
    "https://iaqar.ai/s/sultan/abc123"
  );
  assert.equal(isHostedPreviewHost("x.firebaseapp.com"), true);
  assert.equal(isHostedPreviewHost("iaqar.ai"), false);
});

test("without a preview version sharing safely falls back to /m until the card is published", () => {
  const url = officeShareUrl({ slug: "sultan", officeId: "o1", origin: "https://iaqar.ai", hostname: "iaqar.ai" });
  assert.equal(url, "https://iaqar.ai/m/sultan");
});

test("without a slug the permanent link falls back to the public landing of the office", () => {
  const url = officePermanentUrl({ officeId: "o1", origin: "https://iaqar.ai" });
  assert.match(url, /office=o1/);
});

test("image key changes whenever visible preview content changes", () => {
  const office = { officeName: "مكتب", brokerName: "س", licenseNumber: "1", city: "الرياض", publicSlug: "wadi" };
  const a = shareCardKey(office);
  assert.notEqual(shareCardKey({ ...office, city: "جدة" }), a);
  assert.notEqual(shareCardKey({ ...office, officeName: "آخر" }), a);
  assert.notEqual(shareCardKey({ ...office, licenseNumber: "2" }), a);
  assert.notEqual(shareCardKey({ ...office, brokerPhotoUrl: "data:image/jpeg;base64,AAAA" }), a);
  assert.notEqual(shareCardKey({ ...office, publicSlug: "wadi2" }), a);
});

test("forced refresh preserves the deterministic key and appends a safe unique suffix", () => {
  assert.equal(nonceKey("abc12-lq3x"), "abc12");
  assert.equal(nonceKey("abc12"), "abc12");
  assert.equal(previewVersion("abc12-lq3x"), "abc12-lq3x");
  assert.equal(previewVersion("../bad?x=1"), "badx1");
});


test("menu share waits for immutable publish and passes the current preview version", () => {
  const source = readFileSync(new URL("../public/os/views/shell.js", import.meta.url), "utf8");
  assert.match(source, /await ensureShareCard\(\)/);
  assert.match(source, /sharePreviewFormat === "immutable-v2"/);
  assert.match(source, /preview: office\.sharePreviewFormat[\s\S]*office\.shareCardNonce/);
});
