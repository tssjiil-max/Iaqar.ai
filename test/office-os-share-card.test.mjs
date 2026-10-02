import test from "node:test";
import assert from "node:assert/strict";
import { nonceKey, isHostedPreviewHost, officeShareUrl, shareCardKey } from "../public/os/domain/share-card-domain.js";

test("hosted preview domains use the Worker link, custom domains the short link", () => {
  const base = { slug: "Sultan", officeId: "o1", origin: "https://iaqar-ai-staging--staging-x.web.app", workerOrigin: "https://w.example.workers.dev/" };
  assert.equal(officeShareUrl({ ...base, hostname: "iaqar-ai-staging--staging-x.web.app" }), "https://w.example.workers.dev/m/sultan");
  assert.equal(officeShareUrl({ ...base, origin: "https://iaqar.ai", hostname: "iaqar.ai" }), "https://iaqar.ai/m/sultan");
  assert.equal(isHostedPreviewHost("x.firebaseapp.com"), true);
  assert.equal(isHostedPreviewHost("iaqar.ai"), false);
});

test("without a slug the link falls back to the public landing of the office", () => {
  const url = officeShareUrl({ officeId: "o1", origin: "https://iaqar.ai", hostname: "iaqar.ai" });
  assert.match(url, /office=o1/);
});

test("image key changes only when the preview image changes (photo or slug)", () => {
  const office = { officeName: "مكتب", brokerName: "س", licenseNumber: "1", city: "الرياض", publicSlug: "wadi" };
  const a = shareCardKey(office);
  assert.equal(shareCardKey({ ...office, city: "جدة", officeName: "آخر" }), a, "text is not part of the image");
  assert.notEqual(shareCardKey({ ...office, brokerPhotoUrl: "data:image/jpeg;base64,AAAA" }), a);
  assert.notEqual(shareCardKey({ ...office, publicSlug: "wadi2" }), a, "a new slug needs the image stored under it");
});

test("a forced refresh keeps the card key part of the nonce", () => {
  assert.equal(nonceKey("abc12-lq3x"), "abc12");
  assert.equal(nonceKey("abc12"), "abc12");
  assert.equal(nonceKey(""), "");
});
